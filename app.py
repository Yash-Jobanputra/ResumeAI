import eventlet
eventlet.monkey_patch()

import os
import json
import tempfile
import uuid
import re
import shutil
import traceback
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session, send_file, abort
from flask_socketio import SocketIO, join_room
from flask_cors import CORS
from werkzeug.utils import secure_filename
import google.generativeai as genai
from docx import Document
from dotenv import load_dotenv
import pythoncom
from celery import Celery, Task

load_dotenv()

from database import db, migrate, Resume, Application, ScrapedJD

def make_celery(app):
    celery = Celery(
        app.import_name,
        backend=app.config['result_backend'],
        broker=app.config['broker_url']
    )
    celery.conf.update(app.config)

    class ContextTask(Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery.Task = ContextTask
    return celery

app = Flask(__name__)
CORS(app)

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-here')
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///resumeai.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['broker_url'] = 'redis://localhost:6379/0'
app.config['result_backend'] = 'redis://localhost:6379/0'

db.init_app(app)
migrate.init_app(app, db)
socketio = SocketIO(app, message_queue='redis://localhost:6379/0', async_mode='eventlet')

celery = make_celery(app)
celery.conf.imports = ('celery_worker',)

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'docx'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

class ResumeProcessor:
    def __init__(self):
        self.gemini_models = {
            'gemini-2.5-flash': 'gemini-2.5-flash',
            'gemini-2.5-pro': 'gemini-2.5-pro'
        }

    def extract_text_from_docx(self, file_path):
        try:
            doc = Document(file_path)
            paragraphs = []
            full_text = []
            for i, paragraph in enumerate(doc.paragraphs):
                text = paragraph.text.strip()
                if not text:
                    continue
                full_text.append(text)
                para_info = {'id': i, 'text': text}
                paragraphs.append(para_info)
            return {'paragraphs': paragraphs, 'full_text': '\n'.join(full_text)}
        except Exception as e:
            raise Exception(f"Error processing DOCX file: {str(e)}")

    def _call_gemini_api(self, model, prompt, request_options=None):
        if request_options is None:
            request_options = {}
        try:
            response = model.generate_content(prompt, request_options=request_options)
            json_match = re.search(r'\{.*\}', response.text, re.DOTALL)
            if not json_match:
                if response.text.strip().startswith('{'):
                     return json.loads(response.text, strict=False)
                raise Exception("AI response did not contain a valid JSON object.")
            return json.loads(json_match.group(), strict=False)
        except Exception as e:
            print(f"Error during Gemini API call or JSON parsing: {e}")
            print(f"Full response text was: {response.text if 'response' in locals() else 'N/A'}")
            raise

    # MODIFIED: Logic to handle custom prompts
    def _get_prompt(self, prompt_key, custom_prompts_dict, placeholders):
        default_prompts = {
            "paragraphs": """You are an expert career coach and professional resume writer. Your task is to transform the provided resume paragraphs to be compelling and tailored for the target role. Return a single, valid JSON object.
CONTEXT:
- COMPANY: {COMPANY}
- TARGET JOB DESCRIPTION:
{JOB_DESCRIPTION}

TASK: TRANSFORM {PARAGRAPH_COUNT} RESUME PARAGRAPHS
- SELECTED PARAGRAPHS (as a JSON object of id:text):
{SELECTED_PARAGRAPHS_JSON}
- GUIDELINES: Inject hard and soft skill keywords from the JD wherever possible. Keep action word repetition low. Restructure sentences for maximum impact and flow. Use strong action verbs, quantify achievements, and align experiences with the target role.
- CRITICAL: Only enhance what's there. Never fabricate new achievements. The total word count for all transformed paragraphs must not exceed {TOTAL_WORD_LIMIT}.

CRITICAL OUTPUT: Your entire response MUST be a single, valid JSON object with this exact structure:
{JSON_STRUCTURE}""",
            "single_paragraph": """You are an expert career coach and professional resume writer. Your task is to transform the provided resume paragraphs to be compelling and tailored for the target role. Return a single, valid JSON object.
CONTEXT:
- COMPANY: {COMPANY}
- TARGET JOB DESCRIPTION:
{JOB_DESCRIPTION}

TASK: TRANSFORM A SINGLE PARAGRAPH
- ORIGINAL PARAGRAPH: "{ORIGINAL_PARAGRAPH}"
- GUIDELINES: Dramatically improve the paragraph by restructuring sentences for impact, using strong action verbs, quantifying achievements, and integrating keywords from the job description. Maintain a confident, results-oriented tone.
- CRITICAL: Only enhance what's there. Do not fabricate new achievements. The new paragraph must be a similar length, not exceeding {WORD_LIMIT} words.

CRITICAL OUTPUT: Your entire response MUST be a single, valid JSON object with this exact structure:
{JSON_STRUCTURE}""",
            "cover_letter": """You are an expert career coach. Your task is to write a cover letter and provide a job match score based on the provided context. Return a single, valid JSON object.
CONTEXT:
- COMPANY: {COMPANY}
- TARGET JOB DESCRIPTION:
{JOB_DESCRIPTION}
- FULL RESUME TEXT:
{FULL_RESUME_TEXT}

TASK: WRITE COVER LETTER & PROVIDE MATCH SCORE
- Write a compelling, professional cover letter (3-4 paragraphs, 250-300 words).
- Provide a brutally honest job match score (1-100).
- GUIDELINES: Use a professional tone, show knowledge of the company, and highlight key achievements from the resume. Use plain text only with NO MARKDOWN.
- Match Score (1–100): 90–100 = exceptional; 80–89 = strong; 70–79 = good; below 70 = moderate to weak.

CRITICAL OUTPUT: Your entire response MUST be a single, valid JSON object with this exact structure:
{JSON_STRUCTURE}""",
            "interview_prep": """You are an expert career coach and interview preparation specialist. Your task is to generate a comprehensive set of interview questions and exemplary answers based on the candidate's resume and the target job description. Return a single, valid JSON object.
CONTEXT:
- COMPANY: {COMPANY}
- TARGET ROLE: {JOB_TITLE}
- TARGET JOB DESCRIPTION:
{JOB_DESCRIPTION}
- CANDIDATE'S FULL RESUME TEXT:
{FULL_RESUME_TEXT}

TASK: GENERATE INTERVIEW QUESTIONS & ANSWERS
Generate two distinct categories of questions. For each question, provide both 'talking_points' (a bulleted list of key ideas to convey) and a complete sample 'answer'.

1.  **General Questions (5 questions):** Tailored to the candidate's specific resume. Scrutinize their career path, skills, and experiences (e.g., job gaps, career changes, specific projects).
2.  **Role-Based Questions (5 questions):** Highly specific to the technical and functional requirements of the job description, framed in the context of the candidate's resume.

CRITICAL OUTPUT: Your entire response MUST be a single, valid JSON object with this exact structure. Do not add any text or markdown before or after the JSON object.
{JSON_STRUCTURE}"""
        }

        # Get the base prompt (custom or default)
        prompt_template = (custom_prompts_dict or {}).get(prompt_key) or default_prompts.get(prompt_key)

        # Replace placeholders
        for key, value in placeholders.items():
            placeholder_tag = f"{{{key}}}"
            prompt_template = prompt_template.replace(placeholder_tag, str(value))

        # ALWAYS append JSON structure requirement, even for custom prompts
        if prompt_key == 'paragraphs':
            json_requirement = "\n\nCRITICAL OUTPUT: Your entire response MUST be a single, valid JSON object with this exact structure:\n" + placeholders.get('JSON_STRUCTURE', '{ "customized_paragraphs": { "paragraph_id_1": "new_text_1", ... } }')
        elif prompt_key == 'single_paragraph':
            json_requirement = "\n\nCRITICAL OUTPUT: Your entire response MUST be a single, valid JSON object with this exact structure:\n" + placeholders.get('JSON_STRUCTURE', '{ "enhanced_text": "The new, enhanced paragraph text here..." }')
        elif prompt_key == 'cover_letter':
            json_requirement = "\n\nCRITICAL OUTPUT: Your entire response MUST be a single, valid JSON object with this exact structure:\n" + placeholders.get('JSON_STRUCTURE', '{\n  "cover_letter": "The full cover letter text here...",\n  "match_score": 85\n}')
        elif prompt_key == 'interview_prep':
            json_requirement = "\n\nCRITICAL OUTPUT: Your entire response MUST be a single, valid JSON object with this exact structure. Do not add any text or markdown before or after the JSON object.\n" + placeholders.get('JSON_STRUCTURE', '{\n  "general_questions": [\n    { "question": "...", "talking_points": ["..."], "answer": "..." }\n  ],\n  "role_based_questions": [\n    { "question": "...", "talking_points": ["..."], "answer": "..." }\n  ]\n}')

        prompt_template += json_requirement

        # DEBUG: Print the final prompt being sent to AI
        print(f"\n=== DEBUG: Final prompt for {prompt_key} ===")
        print(f"Custom prompt provided: {custom_prompts_dict.get(prompt_key, 'None')[:200]}...")
        print(f"Final prompt length: {len(prompt_template)}")
        print(f"Contains JSON_STRUCTURE: {'JSON_STRUCTURE' in prompt_template}")
        print(f"Contains 'JSON object': {'JSON object' in prompt_template}")
        print(f"Contains 'CRITICAL OUTPUT': {'CRITICAL OUTPUT' in prompt_template}")
        print("=== First 500 chars of prompt ===")
        print(prompt_template[:500])
        print("=== Last 500 chars of prompt ===")
        print(prompt_template[-500:])
        print("=== End Debug ===\n")

        return prompt_template

    def _generate_paragraphs(self, model, resume_data, selected_paragraph_ids, job_description, company_name, regenerate_type, custom_prompts):
        if isinstance(regenerate_type, dict) and 'single_paragraph' in regenerate_type:
            para_text = regenerate_type['single_paragraph']
            original_words = len(para_text.split())
            placeholders = {
                'COMPANY': company_name,
                'JOB_DESCRIPTION': job_description,
                'ORIGINAL_PARAGRAPH': para_text,
                'WORD_LIMIT': original_words + 15,
                'JSON_STRUCTURE': '{ "enhanced_text": "The new, enhanced paragraph text here..." }'
            }
            prompt = self._get_prompt('single_paragraph', custom_prompts, placeholders)
        else:
            selected_paragraphs_dict = {p['id']: p['text'] for p in resume_data['paragraphs'] if p['id'] in selected_paragraph_ids}
            total_original_words = sum(len(text.split()) for text in selected_paragraphs_dict.values())
            placeholders = {
                'COMPANY': company_name,
                'JOB_DESCRIPTION': job_description,
                'PARAGRAPH_COUNT': len(selected_paragraphs_dict),
                'SELECTED_PARAGRAPHS_JSON': json.dumps(selected_paragraphs_dict, indent=2),
                'TOTAL_WORD_LIMIT': total_original_words + 20,
                'JSON_STRUCTURE': '{ "customized_paragraphs": { "paragraph_id_1": "new_text_1", ... } }'
            }
            prompt = self._get_prompt('paragraphs', custom_prompts, placeholders)
        
        return self._call_gemini_api(model, prompt)

    def _generate_cover_letter(self, model, resume_data, job_description, company_name, custom_prompts):
        placeholders = {
            'COMPANY': company_name,
            'JOB_DESCRIPTION': job_description,
            'FULL_RESUME_TEXT': resume_data['full_text'],
            'JSON_STRUCTURE': '{\n  "cover_letter": "The full cover letter text here...",\n  "match_score": 85\n}'
        }
        prompt = self._get_prompt('cover_letter', custom_prompts, placeholders)
        return self._call_gemini_api(model, prompt)

    def generate_ai_customization(self, api_key, model_name, resume_data, selected_paragraph_ids, job_description, company_name, regenerate_type=None, custom_prompts=None):
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(self.gemini_models[model_name])
            
            final_output = {'customized_paragraphs': {}, 'cover_letter': '', 'match_score': None, 'enhanced_text': None}

            do_paragraphs = regenerate_type is None or regenerate_type == 'paragraphs' or isinstance(regenerate_type, dict)
            do_cover_letter = regenerate_type is None or regenerate_type == 'cover_letter'

            if do_paragraphs:
                para_result = self._generate_paragraphs(model, resume_data, selected_paragraph_ids, job_description, company_name, regenerate_type, custom_prompts)
                final_output['enhanced_text'] = para_result.get('enhanced_text')
                if 'customized_paragraphs' in para_result:
                    id_to_text_map = {p['id']: p['text'] for p in resume_data['paragraphs']}
                    for pid, enhanced_text in para_result['customized_paragraphs'].items():
                        try:
                            original_text = id_to_text_map[int(pid)]
                            final_output['customized_paragraphs'][original_text] = enhanced_text
                        except (KeyError, ValueError):
                            print(f"!! DEBUG WARNING: AI returned paragraph ID '{pid}' which was not found. Skipping.")

            if do_cover_letter:
                cl_result = self._generate_cover_letter(model, resume_data, job_description, company_name, custom_prompts)
                final_output['cover_letter'] = cl_result.get('cover_letter')
                final_output['match_score'] = cl_result.get('match_score')

            return final_output
        except Exception as e:
            print(f"AI Generation Error: {traceback.format_exc()}")
            raise Exception(f"Error generating AI customization: {str(e)}")
            
    def generate_interview_prep(self, api_key, model_name, resume_full_text, job_description, company_name, job_title, custom_prompts=None):
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(self.gemini_models[model_name])
            
            json_structure = """{
  "general_questions": [
    { "question": "...", "talking_points": ["..."], "answer": "..." }
  ],
  "role_based_questions": [
    { "question": "...", "talking_points": ["..."], "answer": "..." }
  ]
}"""
            placeholders = {
                'COMPANY': company_name,
                'JOB_TITLE': job_title,
                'JOB_DESCRIPTION': job_description,
                'FULL_RESUME_TEXT': resume_full_text,
                'JSON_STRUCTURE': json_structure
            }
            prompt = self._get_prompt('interview_prep', custom_prompts, placeholders)
            return self._call_gemini_api(model, prompt, request_options={"timeout": 300})
        except Exception as e:
            print(f"Interview Prep Generation Error: {traceback.format_exc()}")
            raise Exception(f"Error generating interview prep materials: {str(e)}")

    def update_docx_with_customizations(self, original_file_path, customizations):
        customized_paragraphs_dict = customizations.get('customized_paragraphs', {})
        try:
            doc = Document(original_file_path)
            for para in doc.paragraphs:
                original_text = para.text.strip()
                if original_text in customized_paragraphs_dict:
                    new_text = customized_paragraphs_dict[original_text]
                    para.text = ""
                    para.add_run(new_text)
            temp_path = tempfile.mktemp(suffix='.docx')
            doc.save(temp_path)
            return temp_path
        except Exception as e:
            raise Exception(f"Error updating DOCX: {str(e)}")

    def convert_docx_to_pdf(self, docx_path, output_filename):
        try:
            pythoncom.CoInitialize()
            from docx2pdf import convert
            pdf_filename = f"{output_filename}.pdf"
            pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], pdf_filename)
            convert(docx_path, pdf_path)
            return pdf_path, pdf_filename
        except Exception as e:
            print(f"PDF conversion failed: {e}. Falling back to DOCX.")
            docx_filename = f"{output_filename}.docx"
            final_docx_path = os.path.join(app.config['UPLOAD_FOLDER'], docx_filename)
            shutil.copy2(docx_path, final_docx_path)
            return final_docx_path, docx_filename
        finally:
            pythoncom.CoUninitialize()

processor = ResumeProcessor()

@app.before_request
def before_request_func():
    if 'user_session_id' not in session:
        session['user_session_id'] = str(uuid.uuid4())

@socketio.on('connect')
def handle_connect():
    if 'user_session_id' in session:
        join_room(session['user_session_id'])
        socketio.emit('session_id', {'id': session['user_session_id']})

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/customize', methods=['POST'])
def customize_resume():
    try:
        data = request.get_json()
        resume = Resume.query.get_or_404(data.get('resume_id'))
        if resume.user_session_id != session.get('user_session_id'):
            abort(403)
        data['session_id'] = session['user_session_id']
        task = celery.send_task('celery_worker.generate_customization_task', args=[data])
        return jsonify({'job_id': task.id})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
        
@app.route('/save_user_info', methods=['POST'])
def save_user_info():
    data = request.get_json()
    session['user_first_name'] = data.get('first_name', '')
    session['user_last_name'] = data.get('last_name', '')
    return jsonify({'message': 'User information saved successfully'})

@app.route('/api/status', methods=['GET'])
def get_status():
    has_set_name = 'user_first_name' in session and session['user_first_name']
    resumes_count = 0
    if has_set_name:
        resumes_count = Resume.query.filter_by(user_session_id=session.get('user_session_id')).count()
    return jsonify({
        'has_set_name': has_set_name, 
        'resumes_count': resumes_count,
        'session_id': session.get('user_session_id')
    })

@app.route('/api/resumes', methods=['POST'])
def upload_resume():
    if 'resume_file' not in request.files: return jsonify({'error': 'No file part'}), 400
    file = request.files['resume_file']
    if file.filename == '': return jsonify({'error': 'No selected file'}), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{uuid.uuid4()}_{filename}")
        file.save(file_path)

        try:
            cached_structured_text = processor.extract_text_from_docx(file_path)
        except Exception as e:
            print(f"Error extracting text from {filename} on upload: {e}")
            cached_structured_text = None

        new_resume = Resume(
            resume_name=request.form.get('resume_name'),
            original_file_path=file_path,
            user_session_id=session.get('user_session_id'),
            user_first_name=request.form.get('first_name'),
            user_last_name=request.form.get('last_name'),
            structured_text=cached_structured_text
        )
        db.session.add(new_resume)
        db.session.commit()
        return jsonify(new_resume.to_dict())
    return jsonify({'error': 'Invalid file type'}), 400

@app.route('/api/resumes', methods=['GET'])
def get_resumes():
    resumes = Resume.query.filter_by(user_session_id=session.get('user_session_id')).all()
    return jsonify([r.to_dict() for r in resumes])

@app.route('/api/resumes/<int:resume_id>', methods=['GET'])
def get_resume_details(resume_id):
    resume = Resume.query.get_or_404(resume_id)
    if resume.user_session_id != session.get('user_session_id'): abort(403)
    details = resume.to_dict()
    try:
        if resume.structured_text and 'paragraphs' in resume.structured_text:
            details['paragraphs'] = resume.structured_text['paragraphs']
        else:
            resume_content = processor.extract_text_from_docx(resume.original_file_path)
            details['paragraphs'] = resume_content.get('paragraphs', [])
    except Exception as e:
        details['paragraphs'] = []
        details['error'] = f"Could not read DOCX file: {e}"
    return jsonify(details)

@app.route('/api/resumes/<int:resume_id>/selections', methods=['PUT'])
def save_resume_selections(resume_id):
    resume = Resume.query.get_or_404(resume_id)
    if resume.user_session_id != session.get('user_session_id'): abort(403)
    data = request.get_json()
    resume.selected_paragraph_ids = data.get('selected_paragraph_ids', [])
    db.session.commit()
    return jsonify({'message': 'Selections updated successfully'})

@app.route('/api/resumes/<int:resume_id>', methods=['DELETE'])
def delete_resume(resume_id):
    resume = Resume.query.get_or_404(resume_id)
    if resume.user_session_id != session.get('user_session_id'): abort(403)
    try:
        if os.path.exists(resume.original_file_path):
            os.remove(resume.original_file_path)
    except Exception as e:
        print(f"Error deleting file {resume.original_file_path}: {e}")
    db.session.delete(resume)
    db.session.commit()
    return jsonify({'message': 'Resume deleted'})

@app.route('/api/applications', methods=['POST'])
def save_application():
    data = request.get_json()
    resume = Resume.query.get_or_404(data.get('resume_id'))
    new_app = Application(
        company_name=data.get('company_name'),
        job_description=data.get('job_description', ''),
        status=data.get('status', 'not_applied'),
        match_score=data.get('match_score'),
        cover_letter=data.get('cover_letter'),
        customized_paragraphs=data.get('customized_paragraphs'),
        user_session_id=session.get('user_session_id'),
        resume_id=resume.id
    )
    db.session.add(new_app)
    db.session.commit()
    return jsonify(new_app.to_dict())

@app.route('/api/applications', methods=['GET'])
def get_applications():
    apps = Application.query.filter_by(user_session_id=session.get('user_session_id')).order_by(Application.created_date.desc()).all()
    return jsonify([app.to_dict() for app in apps])

@app.route('/api/applications/<int:app_id>', methods=['GET'])
def get_application_details(app_id):
    app = Application.query.get_or_404(app_id)
    if app.user_session_id != session.get('user_session_id'): abort(403)
    return jsonify(app.to_dict())

@app.route('/api/applications/<int:app_id>', methods=['PUT'])
def update_application(app_id):
    app = Application.query.get_or_404(app_id)
    if app.user_session_id != session.get('user_session_id'): abort(403)
    data = request.get_json()
    if 'status' in data:
        app.status = data['status']
    app.updated_date = datetime.utcnow()
    db.session.commit()
    return jsonify(app.to_dict())

@app.route('/api/applications/<int:app_id>', methods=['DELETE'])
def delete_application(app_id):
    app = Application.query.get_or_404(app_id)
    if app.user_session_id != session.get('user_session_id'): abort(403)
    db.session.delete(app)
    db.session.commit()
    return jsonify({'message': 'Application deleted'})

@app.route('/api/applications/<int:app_id>/generate-interview-prep', methods=['POST'])
def generate_interview_prep(app_id):
    try:
        app = Application.query.get_or_404(app_id)
        if app.user_session_id != session.get('user_session_id'):
            abort(403)
        
        data = request.get_json() or {}
        task_data = {
            'app_id': app.id,
            'session_id': session['user_session_id'],
            'ai_model': data.get('ai_model', 'gemini-2.5-pro'),
            'custom_prompts': data.get('custom_prompts') # Pass custom prompts
        }
        
        task = celery.send_task('celery_worker.generate_interview_prep_task', args=[task_data])
        return jsonify({'job_id': task.id})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# MODIFIED: Endpoint now a POST to receive custom prompt in body
@app.route('/api/applications/<int:app_id>/interview-prompt-text', methods=['POST'])
def get_interview_prompt_text(app_id):
    try:
        application = Application.query.get_or_404(app_id)
        if application.user_session_id != session.get('user_session_id'):
            abort(403)

        resume = application.resume
        if not resume or not resume.structured_text or 'full_text' not in resume.structured_text:
             return jsonify({'error': 'Resume text not found or not cached.'}), 404
        
        scraped_jd = ScrapedJD.query.filter_by(
            user_session_id=session.get('user_session_id'),
            company_name=application.company_name
        ).order_by(ScrapedJD.created_date.desc()).first()
        job_title = scraped_jd.job_title if scraped_jd else f"Role at {application.company_name}"
        
        data = request.get_json() or {}
        custom_prompts = {'interview_prep': data.get('custom_prompt')}
        
        json_structure = """{...}""" # Structure doesn't need to be fully verbose here
        placeholders = {
            'COMPANY': application.company_name,
            'JOB_TITLE': job_title,
            'JOB_DESCRIPTION': application.job_description,
            'FULL_RESUME_TEXT': resume.structured_text['full_text'],
            'JSON_STRUCTURE': json_structure
        }
        prompt_text = processor._get_prompt('interview_prep', custom_prompts, placeholders)
        
        return jsonify({'prompt_text': prompt_text})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/scraped-jds', methods=['POST'])
def add_scraped_jd():
    data = request.get_json()
    user_session_id = data.get('user_session_id')
    if not user_session_id:
        return jsonify({'error': 'user_session_id is required'}), 400
    
    new_jd = ScrapedJD(
        job_title=data.get('job_title', 'N/A'),
        company_name=data.get('company_name', 'N/A'),
        job_description=data.get('job_description', ''),
        page_url=data.get('page_url', ''),
        user_session_id=user_session_id
    )
    db.session.add(new_jd)
    db.session.commit()
    return jsonify(new_jd.to_dict()), 201

@app.route('/api/scraped-jds', methods=['GET'])
def get_scraped_jds():
    user_session_id = session.get('user_session_id')
    if not user_session_id:
        return jsonify([])
    
    jds = ScrapedJD.query.filter_by(user_session_id=user_session_id).order_by(ScrapedJD.created_date.desc()).all()
    return jsonify([jd.to_dict() for jd in jds])

@app.route('/api/scraped-jds/<int:jd_id>', methods=['DELETE'])
def delete_scraped_jd(jd_id):
    jd = ScrapedJD.query.get_or_404(jd_id)
    if jd.user_session_id != session.get('user_session_id'):
        abort(403)
    db.session.delete(jd)
    db.session.commit()
    return jsonify({'message': 'Scraped JD deleted'})

@app.route('/api/download_resume', methods=['POST'])
def download_resume_file():
    data = request.get_json()
    data['session_id'] = session['user_session_id']
    task = celery.send_task('celery_worker.create_download_file_task', args=[data])
    return jsonify({'job_id': task.id})

@app.route('/download/<filename>')
def download_file(filename):
    return send_file(os.path.join(app.config['UPLOAD_FOLDER'], filename), as_attachment=True)

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    socketio.run(app, debug=True, host='127.0.0.1', port=5001, use_reloader=False)
