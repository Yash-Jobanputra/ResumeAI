import eventlet
eventlet.monkey_patch()

import os
import time
import traceback
import redis
import tempfile
from docx import Document
import pythoncom
from flask_socketio import SocketIO
from app import celery, ResumeProcessor, Resume, db, Application, ScrapedJD

# Initialize SocketIO with Redis message queue for cross-process communication
socketio = SocketIO(message_queue='redis://localhost:6379/0')

def initialize_worker_system():
    """Initialize system components in Celery worker to eliminate first-request delays"""
    print("🚀 Starting Celery worker system initialization...")

    try:
        # 1. Initialize Python COM for DOCX processing (main culprit for slow first request)
        print("📄 Initializing Python COM in worker...")
        pythoncom.CoInitialize()
        # Create a dummy document to force COM initialization
        try:
            temp_doc = Document()
            temp_doc.add_paragraph("Worker initialization test")
            temp_path = tempfile.mktemp(suffix='.docx')
            temp_doc.save(temp_path)
            os.remove(temp_path)
            print("✅ Worker COM initialization complete")
        except Exception as e:
            print(f"⚠️ Worker COM initialization warning: {e}")

        # 2. Pre-initialize heavy modules
        print("📦 Pre-loading heavy modules in worker...")
        try:
            # Import modules that might be slow on first use
            import docx2pdf
            print("✅ Worker heavy modules pre-loaded")
        except Exception as e:
            print(f"⚠️ Worker module pre-loading warning: {e}")

        print("🎉 Celery worker initialization complete")

    except Exception as e:
        print(f"❌ Celery worker initialization failed: {e}")
    finally:
        # Clean up COM
        try:
            pythoncom.CoUninitialize()
        except:
            pass

# Initialize worker system immediately when worker starts
initialize_worker_system()

processor = ResumeProcessor()

@celery.task(bind=True)
def generate_customization_task(self, data):
    session_id = data.get('session_id')
    
    def emit_progress(status):
        socketio.emit('task_progress', {'status': status}, room=session_id)
        time.sleep(1)

    try:
        # Load multiple API keys from environment
        api_keys = []
        combined_keys = os.environ.get('GEMINI_API_KEYS', '')
        if combined_keys:
            api_keys = [key.strip() for key in combined_keys.split(',') if key.strip()]

        if not api_keys:
            for i in range(1, 11):  # Support up to 10 individual keys
                key = os.environ.get(f'GEMINI_API_KEY_{i}')
                if key:
                    api_keys.append(key)
                else:
                    break

        if not api_keys:
            single_key = os.environ.get('GEMINI_API_KEY')
            if single_key:
                api_keys = [single_key]

        if not api_keys:
            raise Exception("No GEMINI_API_KEY found on worker.")

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
        # MODIFIED: Implement robust model fallback logic with multiple API keys
        initial_model = data.get('ai_model', 'gemini-2.5-pro')
        models_to_try = [initial_model]
        if initial_model != 'gemini-2.5-flash':
            models_to_try.append('gemini-2.5-flash')

        # Try each model with all available API keys
        for model in models_to_try:
            used_keys = set()
            while len(used_keys) < len(api_keys):
                try:
                    api_key = api_keys[len(used_keys)]
                    used_keys.add(api_key)

                    emit_progress(f"Attempting generation with {model} (API key {len(used_keys)}/{len(api_keys)})...")
                    result = processor.generate_ai_customization(
                        api_key,
                        model,
                        resume_content,
                        selected_ids_as_int,
                        data.get('job_description', ''),
                        data.get('company_name', ''),
                        data.get('regenerate'),
                        data.get('custom_prompts') # Pass custom prompts
                    )
                    emit_progress(f"Successfully generated content with {model}!")
                    break
                except Exception as e:
                    print(f"Model {model} with API key {len(used_keys)} failed: {e}")
                    emit_progress(f"Model {model} failed. Trying next API key...")
                    if len(used_keys) == len(api_keys):
                        emit_progress(f"All API keys failed for {model}. Trying next model...")
                        break
            if result:
                break
        
        if isinstance(data.get('regenerate'), dict) and 'single_paragraph' in data.get('regenerate'):
            result['original_paragraph'] = data['regenerate']['single_paragraph']

        if data.get('regenerate'):
            result['regenerate'] = data.get('regenerate')

        # Update scraped job status in database if it was used
        if data.get('scraped_jd_id'):
            try:
                # Import here to avoid circular imports
                from app import ScrapedJD
                jd = ScrapedJD.query.get(data.get('scraped_jd_id'))
                if jd and jd.user_session_id == session_id:
                    jd.status = 'generated'
                    db.session.commit()
            except Exception as e:
                print(f"Warning: Could not update scraped job status: {e}")

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

        print(f"DEBUG: Download task started with customizations: {customizations}")
        print(f"DEBUG: Customizations type: {type(customizations)}")

        resume = Resume.query.get(resume_id)
        if not resume:
            raise Exception("Resume not found for download task.")

        # Ensure customizations is in the right format
        if isinstance(customizations, str):
            try:
                customizations = json.loads(customizations)
                print(f"DEBUG: Parsed customizations from string: {customizations}")
            except json.JSONDecodeError:
                print(f"DEBUG: Could not parse customizations string, using empty dict")
                customizations = {}

        if not isinstance(customizations, dict):
            print(f"DEBUG: Customizations is not a dict, converting to dict")
            customizations = {}

        updated_docx_path = processor.update_docx_with_customizations(
            resume.original_file_path,
            customizations
        )
        output_filename = f"{resume.user_first_name}_{resume.user_last_name}_{company_name}".upper().replace(" ", "_")

        # Check the requested format
        requested_format = data.get('format', 'pdf')
        print(f"DEBUG: Requested format: {requested_format}")

        if requested_format == 'docx':
            # User explicitly requested DOCX - just copy the file
            print(f"DEBUG: User requested DOCX format, copying file directly")
            final_path, final_filename = processor.convert_docx_to_docx(updated_docx_path, output_filename)
        else:
            # Try PDF conversion, fallback to DOCX if it fails
            print(f"DEBUG: Attempting PDF conversion (will fallback to DOCX if needed)")
            final_path, final_filename = processor.convert_docx_to_pdf(updated_docx_path, output_filename)

        download_url = f'/download/{final_filename}'
        socketio.emit('download_ready', {'job_id': self.request.id, 'download_url': download_url}, room=session_id)
        return {'download_url': download_url}

    except Exception as e:
        traceback.print_exc()
        error_message = str(e)
        socketio.emit('task_error', {'job_id': self.request.id, 'error': f'Download failed: {error_message}'}, room=session_id)
        return {'error': error_message}

@celery.task(bind=True)
def generate_interview_prep_task(self, data):
    session_id = data.get('session_id')
    app_id = data.get('app_id')
    
    def emit_progress(status):
        socketio.emit('task_progress', {'status': status, 'context': {'type': 'interview_prep', 'app_id': app_id}}, room=session_id)
        time.sleep(1)

    try:
        # Load multiple API keys from environment
        api_keys = []
        combined_keys = os.environ.get('GEMINI_API_KEYS', '')
        if combined_keys:
            api_keys = [key.strip() for key in combined_keys.split(',') if key.strip()]

        if not api_keys:
            for i in range(1, 11):  # Support up to 10 individual keys
                key = os.environ.get(f'GEMINI_API_KEY_{i}')
                if key:
                    api_keys.append(key)
                else:
                    break

        if not api_keys:
            single_key = os.environ.get('GEMINI_API_KEY')
            if single_key:
                api_keys = [single_key]

        if not api_keys:
            raise Exception("No GEMINI_API_KEY found on worker.")

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
        # MODIFIED: Implement robust model fallback logic with multiple API keys
        initial_model = data.get('ai_model', 'gemini-2.5-pro')
        models_to_try = [initial_model]
        if initial_model != 'gemini-2.5-flash':
            models_to_try.append('gemini-2.5-flash')

        # Try each model with all available API keys
        for model in models_to_try:
            used_keys = set()
            while len(used_keys) < len(api_keys):
                try:
                    api_key = api_keys[len(used_keys)]
                    used_keys.add(api_key)

                    emit_progress(f"Attempting generation with {model} (API key {len(used_keys)}/{len(api_keys)})...")
                    result = processor.generate_interview_prep(
                        api_key,
                        model,
                        resume.structured_text['full_text'],
                        application.job_description,
                        application.company_name,
                        job_title,
                        data.get('custom_prompts') # Pass custom prompts
                    )
                    emit_progress(f"Successfully generated content with {model}!")
                    break
                except Exception as e:
                    print(f"Model {model} with API key {len(used_keys)} failed: {e}")
                    emit_progress(f"Model {model} failed. Trying next API key...")
                    if len(used_keys) == len(api_keys):
                        emit_progress(f"All API keys failed for {model}. Trying next model...")
                        break
            if result:
                break

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
