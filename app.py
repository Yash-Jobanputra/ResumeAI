import os
import json
import tempfile
import uuid
import re
import shutil
import traceback
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session, send_file
from werkzeug.utils import secure_filename
import google.generativeai as genai
from docx import Document

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-here')
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Ensure upload directory exists
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
        """Extract text content from DOCX file as individual paragraphs for user selection"""
        try:
            doc = Document(file_path)
            paragraphs = []
            full_text = []
            
            for i, paragraph in enumerate(doc.paragraphs):
                text = paragraph.text.strip()
                if not text:
                    continue
                
                full_text.append(text)
                
                # Create paragraph object with metadata
                para_info = {
                    'id': i,
                    'text': text,
                    'style': paragraph.style.name if paragraph.style else 'Normal',
                    'is_heading': paragraph.style.name.startswith('Heading') if paragraph.style else False,
                    'font_size': 12,  # Default, could be extracted from runs if needed
                    'is_bold': any(run.bold for run in paragraph.runs) if paragraph.runs else False,
                    'length': len(text),
                    'word_count': len(text.split())
                }
                
                # Try to categorize paragraph type for display
                text_lower = text.lower()
                if any(indicator in text_lower for indicator in ['@', 'phone', 'email', 'linkedin', 'address', 'mobile']):
                    para_info['suggested_type'] = 'Contact Info'
                elif any(keyword in text_lower for keyword in ['summary', 'profile', 'objective']):
                    para_info['suggested_type'] = 'Summary/Objective'
                elif any(keyword in text_lower for keyword in ['experience', 'employment', 'work']):
                    para_info['suggested_type'] = 'Experience Section'
                elif any(keyword in text_lower for keyword in ['education', 'degree', 'university', 'college']):
                    para_info['suggested_type'] = 'Education'
                elif any(keyword in text_lower for keyword in ['skills', 'technical', 'programming']):
                    para_info['suggested_type'] = 'Skills'
                elif any(keyword in text_lower for keyword in ['project', 'built', 'developed']):
                    para_info['suggested_type'] = 'Projects'
                elif any(keyword in text_lower for keyword in ['award', 'achievement', 'honor']):
                    para_info['suggested_type'] = 'Achievements'
                elif any(keyword in text_lower for keyword in ['certification', 'certificate', 'licensed']):
                    para_info['suggested_type'] = 'Certifications'
                else:
                    para_info['suggested_type'] = 'Content'
                
                paragraphs.append(para_info)
            
            return {
                'paragraphs': paragraphs,
                'full_text': '\n'.join(full_text),
                'total_paragraphs': len(paragraphs)
            }
            
        except Exception as e:
            raise Exception(f"Error processing DOCX file: {str(e)}")
    
    def generate_ai_customization(self, api_key, model_name, resume_data, selected_paragraph_ids, job_description, company_name, custom_paragraph_prompt='', custom_cover_letter_prompt='', regenerate_type=None):
        """Generate customized content for selected paragraphs using Gemini AI - Split into 2 requests"""
        
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(self.gemini_models[model_name])
            
            # Get selected paragraphs
            selected_paragraphs = []
            all_paragraphs = resume_data.get('paragraphs', [])
            
            # Convert selected_paragraph_ids to integers for matching
            selected_ids_int = []
            for id_val in selected_paragraph_ids:
                try:
                    selected_ids_int.append(int(id_val))
                except (ValueError, TypeError):
                    selected_ids_int.append(id_val)  # Keep original if conversion fails
            
            print(f"AI Generation: Looking for paragraph IDs: {selected_ids_int}")
            
            for para in all_paragraphs:
                if para['id'] in selected_ids_int:
                    selected_paragraphs.append(para)
                    print(f"AI Generation: Found paragraph {para['id']}: {para['text'][:50]}...")
            
            print(f"AI Generation: Processing {len(selected_paragraphs)} selected paragraphs")
            
            # REQUEST 1: Enhance individual paragraphs (only if not regenerating cover letter only)
            enhanced_paragraphs = {}
            
            if regenerate_type != 'cover_letter':
                original_content = []
                for para in selected_paragraphs:
                    original_content.append(f"[Paragraph {para['id']}]: {para['text']}")
                
                # Calculate original word counts for length control
                original_word_counts = {}
                for para in selected_paragraphs:
                    original_word_counts[para['id']] = len(para['text'].split())
                
                total_original_words = sum(original_word_counts.values())
                
                # Use custom prompt if provided, otherwise use default
                if custom_paragraph_prompt:
                    # Replace placeholders in custom prompt
                    paragraph_prompt = custom_paragraph_prompt.replace('{PARAGRAPHS}', chr(10).join(original_content))
                    paragraph_prompt = paragraph_prompt.replace('{JOB_DESCRIPTION}', job_description)
                    paragraph_prompt = paragraph_prompt.replace('{COMPANY}', company_name)
                    
                    # Add JSON structure requirement
                    json_structure = ', '.join([f'"{para["id"]}": "Enhanced paragraph {para["id"]}"' for para in selected_paragraphs])
                    paragraph_prompt += f"\n\nReturn a JSON object with this EXACT structure:\n{{\n    {json_structure}\n}}"
                    print("Using custom paragraph prompt...")
                else:
                    # Use default prompt (existing logic)
                    paragraph_prompt = f"""
                You are an expert resume writer specializing in transforming resume content for maximum impact. Transform these resume paragraphs to be compelling, ATS-optimized, and perfectly tailored for this specific role.
                
                SELECTED PARAGRAPHS TO TRANSFORM:
                {chr(10).join(original_content)}
                
                TARGET JOB DESCRIPTION:
                {job_description}
                
                COMPANY: {company_name}
                
                WORD COUNT REQUIREMENTS:
                - Original total words: {total_original_words}
                - Maximum total words allowed: {total_original_words + 10}
                - Stay within this limit to prevent resume from becoming too long
                - Individual paragraphs can vary in length as long as total stays within limit
                
                TRANSFORMATION GUIDELINES:
                1. DRAMATICALLY improve each paragraph - don't just add a few words
                2. Restructure sentences for maximum impact and readability
                3. Use powerful action verbs and quantify achievements where possible
                4. Incorporate relevant keywords from the job description naturally
                5. Expand on existing experiences with more compelling details (but stay truthful)
                6. Reframe accomplishments to align with the target role requirements
                7. Make the tone confident and results-oriented
                8. Optimize for ATS scanning with relevant industry terminology
                9. Transform weak passive language into strong active statements
                10. Prioritize impact over length - be concise but powerful
                
                TRUTHFULNESS RULE: Only enhance, reframe, and expand on what's already there. Do not fabricate new companies, roles, or achievements.
                
                Return a JSON object with this EXACT structure:
                {{
                    {', '.join([f'"{para["id"]}": "Dramatically enhanced and restructured version of paragraph {para["id"]}"' for para in selected_paragraphs])}
                }}
                
                CRITICAL: Transform all {len(selected_paragraphs)} paragraphs into powerful, compelling content while staying within the {total_original_words + 10} word limit.
                """
                
                print("Sending paragraph enhancement request to AI...")
                paragraph_response = model.generate_content(paragraph_prompt)
                
                # Parse paragraph response
                json_match = re.search(r'\{.*\}', paragraph_response.text, re.DOTALL)
                if not json_match:
                    raise Exception("AI did not return valid JSON for paragraph enhancement")
                
                enhanced_paragraphs = json.loads(json_match.group())
                print(f"AI returned {len(enhanced_paragraphs)} enhanced paragraphs")
            
            # REQUEST 2: Generate cover letter (only if not regenerating paragraphs only)
            cover_letter_data = {'cover_letter': '', 'match_score': None}
            
            if regenerate_type != 'paragraphs':
                if custom_cover_letter_prompt:
                    # Replace placeholders in custom cover letter prompt
                    cover_letter_prompt = custom_cover_letter_prompt.replace('{RESUME_TEXT}', resume_data.get('full_text', ''))
                    cover_letter_prompt = cover_letter_prompt.replace('{JOB_DESCRIPTION}', job_description)
                    cover_letter_prompt = cover_letter_prompt.replace('{COMPANY}', company_name)
                    print("Using custom cover letter prompt...")
                    
                    print("Sending cover letter request to AI...")
                    cover_letter_response = model.generate_content(cover_letter_prompt)
                    
                    cover_letter_data = {
                        'cover_letter': cover_letter_response.text.strip(),
                        'match_score': None
                    }
                else:
                    # Use default cover letter prompt with match scoring
                    cover_letter_prompt = f"""
                Generate a professional cover letter for this job application and provide a match analysis.
                
                COVER LETTER REQUIREMENTS:
                - Length: 3-4 paragraphs (250-400 words maximum)
                - Professional tone, specific to the role
                - Include 2-3 key achievements from resume
                - Show knowledge of company/role
                - Strong opening and closing
                - CRITICAL: Use plain text only - NO asterisks, NO markdown, NO bold formatting
                - Write as if sending via email or plain text application form
                - Use natural, professional language without formatting markers
                
                FULL RESUME CONTEXT:
                {resume_data.get('full_text', '')}
                
                JOB DESCRIPTION:
                {job_description}
                
                COMPANY: {company_name}
                
                Return a JSON object with this EXACT structure:
                {{
                    "cover_letter": "Professional cover letter text here...",
                    "match_score": 85
                }}
                
                MATCH SCORING CRITERIA (1-100):
                - 90-100: Exceptional match, exceeds most requirements
                - 80-89: Strong match, meets most requirements with relevant experience
                - 70-79: Good match, meets core requirements
                - 60-69: Moderate match, some gaps but potential
                - Below 60: Weak match, significant gaps
                
                Consider: relevant experience, technical skills, industry knowledge, education, achievements alignment.
                """
                
                print("Sending cover letter request to AI...")
                cover_letter_response = model.generate_content(cover_letter_prompt)
                
                # Parse JSON response for default prompts
                try:
                    # Try to parse JSON response
                    json_match = re.search(r'\{.*\}', cover_letter_response.text, re.DOTALL)
                    if json_match:
                        cover_letter_data = json.loads(json_match.group())
                    else:
                        # Fallback to plain text
                        cover_letter_data = {
                            'cover_letter': cover_letter_response.text.strip(),
                            'match_score': None
                        }
                except json.JSONDecodeError:
                    # Fallback to plain text
                    cover_letter_data = {
                        'cover_letter': cover_letter_response.text.strip(),
                        'match_score': None
                    }
            
            return {
                'customized_paragraphs': enhanced_paragraphs,
                'cover_letter': cover_letter_data['cover_letter'],
                'match_score': cover_letter_data.get('match_score'),
                'optimization_notes': f"Enhanced {len(enhanced_paragraphs)} individual paragraphs and generated tailored cover letter for {company_name}"
            }
                
        except Exception as e:
            print(f"AI Generation Error: {str(e)}")
            raise Exception(f"Error generating AI customization: {str(e)}")
    
    def update_docx_with_customizations(self, original_file_path, customizations, selected_paragraph_ids, original_resume_data):
        """Update DOCX file with AI customizations for specific paragraphs"""
        try:
            print(f"DOCX Update: Starting with {len(customizations.get('customized_paragraphs', {}))} customizations")
            
            # Create a copy of the original document
            doc = Document(original_file_path)
            paragraphs = doc.paragraphs
            
            # Get the enhanced paragraphs from AI
            enhanced_paragraphs = customizations.get('customized_paragraphs', {})
            
            if not enhanced_paragraphs:
                print("DOCX Update: No customized paragraphs to apply!")
                temp_path = tempfile.mktemp(suffix='.docx')
                doc.save(temp_path)
                return temp_path
            
            # Create mapping from original text to paragraph IDs for selected paragraphs
            original_paragraphs = original_resume_data.get('paragraphs', [])
            text_to_id_mapping = {}
            
            for para in original_paragraphs:
                # Handle both string and integer paragraph IDs
                para_id_str = str(para['id'])
                if para_id_str in selected_paragraph_ids or para['id'] in selected_paragraph_ids:
                    text_to_id_mapping[para['text'].strip()] = para_id_str
            
            print(f"DOCX Update: Created mapping for {len(text_to_id_mapping)} selected paragraphs")
            print(f"DOCX Update: Enhanced paragraphs keys: {list(enhanced_paragraphs.keys())}")
            print(f"DOCX Update: Text mapping keys: {list(text_to_id_mapping.values())}")
            
            updates_made = 0
            
            for i, paragraph in enumerate(paragraphs):
                text = paragraph.text.strip()
                if not text:
                    continue
                
                # Find the paragraph ID for this text
                paragraph_id = text_to_id_mapping.get(text)
                
                if paragraph_id and paragraph_id in enhanced_paragraphs:
                    new_text = enhanced_paragraphs[paragraph_id]
                    print(f"DOCX Update: Replacing paragraph {paragraph_id}")
                    print(f"  Original ({len(text)} chars): {text[:100]}...")
                    print(f"  New ({len(new_text)} chars): {new_text[:100]}...")
                    
                    # Clear the paragraph and add new text
                    paragraph.clear()
                    paragraph.add_run(new_text)
                    updates_made += 1
                elif text and len(text) > 20:  # Only log substantial paragraphs
                    # Show what ID this text would have
                    found_id = text_to_id_mapping.get(text, "NOT_FOUND")
                    print(f"DOCX Update: No customization for ID {found_id}: {text[:50]}...")
            
            print(f"DOCX Update: Applied {updates_made} customizations")
            
            # Save the updated document
            temp_path = tempfile.mktemp(suffix='.docx')
            doc.save(temp_path)
            return temp_path
            
        except Exception as e:
            print(f"DOCX Update Error: {str(e)}")
            raise Exception(f"Error updating DOCX: {str(e)}")
    
    def convert_docx_to_pdf(self, docx_path, output_filename, company_name):
        """On Linux, just return the DOCX file for manual conversion"""
        try:
            # Try docx2pdf first (won't work on Linux but worth trying)
            from docx2pdf import convert
            pdf_filename = f"{output_filename}.pdf"
            pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], pdf_filename)
            convert(docx_path, pdf_path)
            return pdf_path, pdf_filename
        except Exception as e:
            print(f"docx2pdf failed (expected on Linux): {e}")
            # Return the DOCX file instead
            docx_filename = f"{output_filename}.docx"
            final_docx_path = os.path.join(app.config['UPLOAD_FOLDER'], docx_filename)
            
            # Copy the updated DOCX to the final location
            shutil.copy2(docx_path, final_docx_path)
            
            return final_docx_path, docx_filename

# Initialize processor
processor = ResumeProcessor()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/save_user_info', methods=['POST'])
def save_user_info():
    data = request.get_json()
    first_name = data.get('first_name', '').strip()
    last_name = data.get('last_name', '').strip()
    
    if not first_name or not last_name:
        return jsonify({'error': 'First name and last name are required'}), 400
    
    session['user_first_name'] = first_name
    session['user_last_name'] = last_name
    
    return jsonify({'message': 'User information saved successfully'})

@app.route('/upload', methods=['POST'])
def upload_resume():
    if 'resume' not in request.files:
        return jsonify({'error': 'No file selected'}), 400
    
    file = request.files['resume']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if file and allowed_file(file.filename):
        try:
            # Save uploaded file
            filename = secure_filename(file.filename)
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(file_path)
            
            # Extract content
            resume_data = processor.extract_text_from_docx(file_path)
            
            # Store in session (store only essential data to avoid session size limits)
            session['resume_file'] = file_path
            session['original_filename'] = filename.rsplit('.', 1)[0]
            
            return jsonify({
                'message': 'Resume uploaded successfully',
                'resume_data': resume_data
            })
            
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    return jsonify({'error': 'Invalid file type. Please upload a DOCX file.'}), 400

@app.route('/save_selections', methods=['POST'])
def save_selections():
    data = request.get_json()
    selected_paragraph_ids = data.get('selected_paragraph_ids', [])
    ai_model = data.get('ai_model', 'gemini-2.5-flash')
    api_key = data.get('api_key', '')
    custom_paragraph_prompt = data.get('custom_paragraph_prompt', '')
    custom_cover_letter_prompt = data.get('custom_cover_letter_prompt', '')
    
    print(f"Saving selections: {len(selected_paragraph_ids)} paragraphs, model: {ai_model}, API key: {'***' if api_key else 'None'}")
    print(f"Selected paragraph IDs: {selected_paragraph_ids}")
    print(f"ID types: {[type(id) for id in selected_paragraph_ids[:5]]}")  # Check first 5 ID types
    print(f"Custom prompts: {'Yes' if custom_paragraph_prompt or custom_cover_letter_prompt else 'No'}")
    
    session['selected_paragraph_ids'] = selected_paragraph_ids
    session['ai_model'] = ai_model
    session['api_key'] = api_key
    session['custom_paragraph_prompt'] = custom_paragraph_prompt
    session['custom_cover_letter_prompt'] = custom_cover_letter_prompt
    
    return jsonify({'message': 'Selections saved successfully'})

@app.route('/customize', methods=['POST'])
def customize_resume():
    try:
        data = request.get_json()
        job_description = data.get('job_description', '')
        company_name = data.get('company_name', '')
        regenerate_type = data.get('regenerate', None)  # 'paragraphs', 'cover_letter', or None
        
        if not job_description or not company_name:
            return jsonify({'error': 'Job description and company name are required'}), 400
        
        # Get session data - selected_paragraph_ids should come from session, not request
        resume_file = session.get('resume_file', '')
        selected_paragraph_ids = session.get('selected_paragraph_ids', [])
        ai_model = session.get('ai_model', 'gemini-2.5-flash')
        api_key = session.get('api_key', '')
        
        print(f"Customize request: {len(selected_paragraph_ids)} selected paragraphs from session")
        print(f"Selected IDs: {selected_paragraph_ids}")
        
        if not api_key:
            return jsonify({'error': 'API key is required'}), 400
            
        if not resume_file or not os.path.exists(resume_file):
            return jsonify({'error': 'Resume file not found'}), 400
            
        if not selected_paragraph_ids:
            return jsonify({'error': 'No paragraphs selected. Please go back and select paragraphs to customize.'}), 400
        
        # Re-extract resume data to avoid large session storage
        resume_data = processor.extract_text_from_docx(resume_file)
        
        # Get custom prompts from session
        custom_paragraph_prompt = session.get('custom_paragraph_prompt', '')
        custom_cover_letter_prompt = session.get('custom_cover_letter_prompt', '')
        
        # Store selected paragraphs in session
        session['selected_paragraph_ids'] = selected_paragraph_ids
        
        # Generate AI customizations
        customizations = processor.generate_ai_customization(
            api_key, ai_model, resume_data, selected_paragraph_ids, 
            job_description, company_name, custom_paragraph_prompt, custom_cover_letter_prompt,
            regenerate_type
        )
        
        # Store customizations in a file instead of session to avoid size limits
        customizations_file = os.path.join(app.config['UPLOAD_FOLDER'], f'customizations_{uuid.uuid4().hex}.json')
        with open(customizations_file, 'w') as f:
            json.dump(customizations, f)
        
        # Store only the file path in session
        session['customizations_file'] = customizations_file
        session['latest_company'] = company_name
        
        return jsonify({
            'message': 'Resume customized successfully',
            'customizations': customizations,
            'customizations_file': customizations_file
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/generate_pdf', methods=['POST'])
def generate_pdf():
    try:
        data = request.get_json()
        
        # Generate filename using user info
        first_name = session.get('user_first_name', '')
        last_name = session.get('user_last_name', '')
        company_name = session.get('latest_company', 'Company')
        
        if first_name and last_name:
            output_filename = f"{first_name.upper()}_{last_name.upper()}_{company_name.upper().replace(' ', '_')}_RESUME"
        else:
            output_filename = data.get('filename', session.get('original_filename', 'resume'))
        
        print(f"PDF Generation Request - Filename: {output_filename}")
        
        # Get session data
        customizations_file = session.get('customizations_file', '')
        selected_paragraph_ids = session.get('selected_paragraph_ids', [])
        company_name = session.get('latest_company', 'Company')
        resume_file = session.get('resume_file', '')
        
        print(f"Session data check:")
        print(f"  - Customizations file: {customizations_file}")
        print(f"  - Resume file: {resume_file}")
        print(f"  - Selected paragraphs: {len(selected_paragraph_ids)}")
        print(f"  - Company name: {company_name}")
        
        # Load customizations from file
        customizations = {}
        if customizations_file and os.path.exists(customizations_file):
            try:
                with open(customizations_file, 'r') as f:
                    customizations = json.load(f)
                print(f"  - Loaded customizations with {len(customizations)} items")
            except Exception as e:
                print(f"  - Error loading customizations: {e}")
        
        if not customizations:
            print("ERROR: No customizations available")
            return jsonify({'error': 'No customizations available. Please complete the AI customization step first.'}), 400
            
        if not resume_file:
            print("ERROR: No resume file found")
            return jsonify({'error': 'No resume file found. Please upload a resume first.'}), 400
        
        if not os.path.exists(resume_file):
            print(f"ERROR: Resume file not found at path: {resume_file}")
            return jsonify({'error': 'Resume file not found on server.'}), 400
        
        # Re-extract resume data
        original_resume_data = processor.extract_text_from_docx(resume_file)
        
        print("Starting DOCX update...")
        # Update DOCX with customizations
        updated_docx_path = processor.update_docx_with_customizations(
            resume_file, customizations, selected_paragraph_ids, original_resume_data
        )
        print(f"DOCX updated: {updated_docx_path}")
        
        print("Starting PDF conversion...")
        # Convert to PDF
        pdf_path, pdf_filename = processor.convert_docx_to_pdf(
            updated_docx_path, output_filename, company_name
        )
        print(f"PDF created: {pdf_path}")
        
        return jsonify({
            'message': 'PDF generated successfully',
            'download_url': f'/download/{pdf_filename}',
            'filename': pdf_filename
        })
        
    except Exception as e:
        print(f"PDF Generation Error: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'PDF generation failed: {str(e)}'}), 500

@app.route('/download/<filename>')
def download_file(filename):
    try:
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        return send_file(file_path, as_attachment=True)
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/status', methods=['GET'])
def get_status():
    """Get current session status"""
    return jsonify({
        'has_resume': 'resume_file' in session,
        'has_selections': 'selected_paragraph_ids' in session,
        'has_api_key': 'api_key' in session and bool(session['api_key']),
        'resume_data': session.get('resume_data', {}),
        'selected_paragraph_ids': session.get('selected_paragraph_ids', []),
        'ai_model': session.get('ai_model', 'gemini-2.5-flash')
    })

# Application Tracking System
APPLICATIONS_FILE = os.path.join(app.config['UPLOAD_FOLDER'], 'applications.json')

def load_applications():
    """Load applications from JSON file"""
    try:
        if os.path.exists(APPLICATIONS_FILE):
            with open(APPLICATIONS_FILE, 'r') as f:
                return json.load(f)
    except Exception:
        pass
    return []

def save_applications(applications):
    """Save applications to JSON file"""
    try:
        with open(APPLICATIONS_FILE, 'w') as f:
            json.dump(applications, f, indent=2)
        return True
    except Exception:
        return False

@app.route('/save_application', methods=['POST'])
def save_application():
    """Save a completed resume customization as an application"""
    try:
        data = request.get_json()
        company_name = data.get('company_name', '')
        job_description = data.get('job_description', '')
        customizations_file = data.get('customizations_file', '')
        resume_file = data.get('resume_file', '')
        
        print(f"=== SAVE APPLICATION DEBUG ===")
        print(f"Company: {company_name}")
        print(f"Customizations file received: '{customizations_file}'")
        print(f"Resume file: '{resume_file}'")
        print(f"================================")
        
        if not company_name:
            return jsonify({'error': 'Company name is required'}), 400
        
        # Load cover letter from customizations if available
        cover_letter = ""
        match_score = None
        if customizations_file and os.path.exists(customizations_file):
            try:
                print(f"Loading customizations from: {customizations_file}")
                with open(customizations_file, 'r') as f:
                    customizations = json.load(f)
                    cover_letter = customizations.get('cover_letter', '')
                    match_score = customizations.get('match_score')
                    print(f"Loaded cover letter length: {len(cover_letter)} characters")
                    print(f"Match score: {match_score}")
            except Exception as e:
                print(f"Error loading customizations: {e}")
        else:
            print(f"Customizations file not found or path empty: {customizations_file}")
            print(f"File exists: {os.path.exists(customizations_file) if customizations_file else 'No path provided'}")
        # Load existing applications
        applications = load_applications()
        
        # Create new application record
        application = {
            'id': str(uuid.uuid4()),
            'company_name': company_name,
            'job_description': job_description,
            'customizations_file': customizations_file,
            'resume_file': resume_file,
            'cover_letter': cover_letter,
            'match_score': match_score,
            'status': 'not_applied',
            'created_date': datetime.now().isoformat(),
            'updated_date': datetime.now().isoformat()
        }
        
        applications.append(application)
        
        if save_applications(applications):
            return jsonify({'message': 'Application saved successfully', 'application_id': application['id']})
        else:
            return jsonify({'error': 'Failed to save application'}), 500
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/applications', methods=['GET'])
def get_applications():
    """Get all saved applications"""
    applications = load_applications()
    return jsonify({'applications': applications})

@app.route('/applications/<application_id>/status', methods=['PUT'])
def update_application_status(application_id):
    """Update application status"""
    try:
        data = request.get_json()
        new_status = data.get('status', '')
        
        if new_status not in ['not_applied', 'applied', 'interview', 'offer', 'rejected']:
            return jsonify({'error': 'Invalid status'}), 400
        
        applications = load_applications()
        
        for app in applications:
            if app['id'] == application_id:
                app['status'] = new_status
                app['updated_date'] = datetime.now().isoformat()
                
                if save_applications(applications):
                    return jsonify({'message': 'Status updated successfully'})
                else:
                    return jsonify({'error': 'Failed to update status'}), 500
        
        return jsonify({'error': 'Application not found'}), 404
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/applications/<application_id>', methods=['DELETE'])
def delete_application(application_id):
    try:
        applications = load_applications()
        
        # Find and remove the application
        original_count = len(applications)
        applications = [app for app in applications if app['id'] != application_id]
        
        if len(applications) < original_count:
            if save_applications(applications):
                return jsonify({'message': 'Application deleted successfully'})
            else:
                return jsonify({'error': 'Failed to delete application'}), 500
        else:
            return jsonify({'error': 'Application not found'}), 404
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Try localhost only first (bypasses some firewall issues)
    app.run(debug=True, host='127.0.0.1', port=5001)
