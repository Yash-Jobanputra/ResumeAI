import eventlet
eventlet.monkey_patch()

import os
import time
import traceback
from flask_socketio import SocketIO
from app import celery, ResumeProcessor, Resume, db, Application, ScrapedJD

socketio = SocketIO(message_queue=celery.conf.broker_url)
processor = ResumeProcessor()

@celery.task(bind=True)
def generate_customization_task(self, data):
    session_id = data.get('session_id')
    
    def emit_progress(status):
        socketio.emit('task_progress', {'status': status}, room=session_id)
        time.sleep(1)

    try:
        api_key = os.environ.get('GEMINI_API_KEY')
        if not api_key:
            raise Exception("GEMINI_API_KEY not found on worker.")

        emit_progress("Fetching resume details...")
        resume = Resume.query.get(data.get('resume_id'))
        if not resume:
            raise Exception("Resume not found.")
        
        if resume.structured_text:
            emit_progress("Using cached resume content...")
            resume_content = resume.structured_text
        else:
            emit_progress("No cache found. Parsing DOCX file...")
            resume_content = processor.extract_text_from_docx(resume.original_file_path)
        selected_ids_as_int = {int(id_val) for id_val in resume.selected_paragraph_ids or [] if str(id_val).isdigit()}
        
        result = None
        # Consistent model names
        models_to_try = ['gemini-2.5-pro', 'gemini-2.5-flash']
        for model in models_to_try:
            try:
                emit_progress(f"Attempting generation with {model}...")
                result = processor.generate_ai_customization(
                    api_key,
                    model,
                    resume_content,
                    selected_ids_as_int,
                    data.get('job_description', ''),
                    data.get('company_name', ''),
                    data.get('regenerate')
                )
                emit_progress(f"Successfully generated content with {model}!")
                break 
            except Exception as e:
                print(f"Model {model} failed: {e}")
                emit_progress(f"Model {model} failed. Trying next model...")
                if model == models_to_try[-1]: 
                    raise e 
        
        if isinstance(data.get('regenerate'), dict) and 'single_paragraph' in data.get('regenerate'):
            result['original_paragraph'] = data['regenerate']['single_paragraph']

        if data.get('regenerate'):
            result['regenerate'] = data.get('regenerate')

        socketio.emit('task_success', {'job_id': self.request.id, 'result': result}, room=session_id)
        return result

    except Exception as e:
        traceback.print_exc()
        error_message = str(e)
        socketio.emit('task_error', {'job_id': self.request.id, 'error': error_message}, room=session_id)
        return {'error': error_message}


@celery.task(bind=True)
def create_download_file_task(self, data):
    session_id = data.get('session_id')
    try:
        resume_id = data.get('resume_id')
        customizations = data.get('customizations', {})
        company_name = data.get('company_name', 'resume')
        
        resume = Resume.query.get(resume_id)
        if not resume:
            raise Exception("Resume not found for download task.")

        updated_docx_path = processor.update_docx_with_customizations(
            resume.original_file_path,
            customizations
        )
        output_filename = f"{resume.user_first_name}_{resume.user_last_name}_{company_name}".upper().replace(" ", "_")
        
        final_path, final_filename = processor.convert_docx_to_pdf(updated_docx_path, output_filename)
        
        download_url = f'/download/{final_filename}'
        socketio.emit('download_ready', {'job_id': self.request.id, 'download_url': download_url}, room=session_id)
        return {'download_url': download_url}

    except Exception as e:
        traceback.print_exc()
        error_message = str(e)
        socketio.emit('task_error', {'job_id': self.request.id, 'error': f'Download failed: {error_message}'}, room=session_id)
        return {'error': error_message}

# MODIFIED: Added model fallback logic.
@celery.task(bind=True)
def generate_interview_prep_task(self, data):
    session_id = data.get('session_id')
    app_id = data.get('app_id')
    
    def emit_progress(status):
        socketio.emit('task_progress', {'status': status, 'context': {'type': 'interview_prep', 'app_id': app_id}}, room=session_id)
        time.sleep(1)

    try:
        api_key = os.environ.get('GEMINI_API_KEY')
        if not api_key:
            raise Exception("GEMINI_API_KEY not found on worker.")
        
        emit_progress("Fetching application and resume...")
        application = Application.query.get(app_id)
        if not application:
            raise Exception("Application not found.")
        
        resume = application.resume
        if not resume or not resume.structured_text or 'full_text' not in resume.structured_text:
            raise Exception("Cached resume text not found for this application.")

        scraped_jd = ScrapedJD.query.filter_by(
            user_session_id=session_id,
            company_name=application.company_name
        ).order_by(ScrapedJD.created_date.desc()).first()
        job_title = scraped_jd.job_title if scraped_jd else f"Role at {application.company_name}"
        
        emit_progress("Generating interview questions with AI... (this may take over a minute)")

        result = None
        # Start with the model chosen in the UI, or default to pro, then fall back to flash
        initial_model = data.get('ai_model', 'gemini-2.5-pro')
        models_to_try = [initial_model]
        if initial_model != 'gemini-2.5-flash':
            models_to_try.append('gemini-2.5-flash')
        
        for model in models_to_try:
            try:
                emit_progress(f"Attempting generation with {model}...")
                result = processor.generate_interview_prep(
                    api_key,
                    model,
                    resume.structured_text['full_text'],
                    application.job_description,
                    application.company_name,
                    job_title
                )
                emit_progress(f"Successfully generated content with {model}!")
                break # Exit loop on success
            except Exception as e:
                print(f"Model {model} failed: {e}")
                emit_progress(f"Model {model} failed. Trying next model...")
                if model == models_to_try[-1]: # If this was the last model to try
                    raise e # Re-raise the last exception

        emit_progress("Saving results to database...")
        application.interview_prep = result
        db.session.commit()
        
        socketio.emit('interview_prep_ready', {
            'job_id': self.request.id, 
            'app_id': app_id, 
            'interview_prep': result
        }, room=session_id)
        
        return {'app_id': app_id, 'status': 'success'}

    except Exception as e:
        traceback.print_exc()
        error_message = str(e)
        socketio.emit('task_error', {
            'job_id': self.request.id, 
            'error': error_message,
            'context': {'type': 'interview_prep', 'app_id': app_id}
        }, room=session_id)
        return {'error': error_message}