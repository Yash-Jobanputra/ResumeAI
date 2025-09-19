import eventlet
eventlet.monkey_patch()

import os
import time
import traceback
from flask_socketio import SocketIO
from app import celery, ResumeProcessor, Resume  # Import celery from the app

# This is a bit of a trick to get a SocketIO instance that can emit messages
# outside of a Flask request context. We configure it to use the same Redis message queue.
socketio = SocketIO(message_queue=celery.conf.broker_url)
processor = ResumeProcessor()

@celery.task(bind=True)
def generate_customization_task(self, data):
    session_id = data.get('session_id')
    
    def emit_progress(status):
        socketio.emit('task_progress', {'status': status}, room=session_id)
        time.sleep(1) # Small delay to make sure messages are seen

    try:
        api_key = os.environ.get('GEMINI_API_KEY')
        if not api_key:
            raise Exception("GEMINI_API_KEY not found on worker.")

        emit_progress("Fetching resume details...")
        resume = Resume.query.get(data.get('resume_id'))
        if not resume:
            raise Exception("Resume not found.")
        
        resume_content = processor.extract_text_from_docx(resume.original_file_path)
        selected_ids_as_int = {int(id_val) for id_val in resume.selected_paragraph_ids or [] if str(id_val).isdigit()}
        
        # --- AI Generation with Fallback ---
        result = None
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
        
        # For single paragraph regeneration, add original text to the result
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

