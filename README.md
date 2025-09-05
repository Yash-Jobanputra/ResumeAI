# ResumeAI - Smart Resume Customization

A powerful web application that uses AI to automatically customize your resume for specific job descriptions and generate matching cover letters.

## Features

- **Resume Upload**: Upload DOCX resume files
- **Section Selection**: Choose which sections to customize (Summary, Experience, Skills)
- **AI-Powered Customization**: Uses Google Gemini AI to tailor your resume to job descriptions
- **Cover Letter Generation**: Automatically creates matching cover letters
- **PDF Export**: Download customized resumes as PDFs with proper naming
- **Session Management**: Saves your settings for faster repeated use
- **Save Applications**: Saves your generated applications (if you choose to) and allows you to change status of app stage.

## How It Works

1. **Upload Resume**: Start by uploading your master resume in DOCX format
2. **Preview & Select**: View your resume content and select which sections to customize
3. **AI Configuration**: Choose your AI model (Gemini 2.5 Flash or Pro) and enter your API key
4. **Job Details**: Paste the job description and company name
5. **Generate**: AI customizes your resume and creates a matching cover letter
6. **Download**: Get your customized resume as a PDF with proper naming

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/effionx/ResumeAI
   cd ResumeAI
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Get Google AI API Key**:
   - Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create a new API key
   - Keep it secure for use in the application

4. **Run the application**:
   ```bash
   python app.py
   ```

5. **Access the application**:
   Open your browser and go to `http://localhost:5001`

## Usage

### Step 1: Upload Your Resume
- Click the upload area and select your DOCX resume file
- The application will extract and analyze your resume content

### Step 2: Select Sections to Customize
- Review the extracted resume sections
- Find the lines you want the AI to customize and inject keywords into.
 - Do not put lines you don't wish to be changed (contact info, name etc.)

### Step 3: Configure AI Settings
- Select your preferred AI model:
  - **Gemini 2.5 Flash**: Faster and more cost-effective
  - **Gemini 2.5 Pro**: More advanced capabilities
- Enter your Google AI API key (saved for future sessions)

### Step 4: Enter Job Details
- **Company Name**: Enter the target company name
- **Job Description**: Paste the complete job posting
- Click "Customize Resume" to start AI processing
- Please be aware this step will take time based on the input text but once its fully done, it has already edited the resume and made it into a PDF ready for you to apply with 1-click.

### Step 5: Review and Download
- Review the AI-generated customizations
- Read the generated cover letter
- You can regenerate either the paragraphs or cover letter at this stage.
- Download as PDF (automatically named: `YOUR_NAME_RESUME_COMPANYNAME.pdf`)

## Technical Details

### Backend (Python/Flask)
- **Document Processing**: Uses `python-docx` to read and modify DOCX files
- **AI Integration**: Google Gemini API for intelligent content generation
- **PDF Generation**: `pdfx` for creating downloadable PDFs that preserve formatting
- **Session Management**: Flask sessions for user state persistence

### Frontend (HTML/JavaScript)
- **Responsive Design**: Mobile-friendly interface using Tailwind CSS
- **Interactive UI**: Alpine.js for dynamic user interactions
- **Progress Tracking**: Visual step-by-step workflow
- **File Handling**: Drag-and-drop file upload with progress indication

### Key Libraries
- `Flask`: Web framework
- `python-docx`: DOCX file processing
- `google-generativeai`: AI content generation
- `pdfx`: PDF creation
- `werkzeug`: File handling utilities

## Security Features

- File type validation (DOCX only)
- Secure filename handling
- Session-based data storage
- API key protection (stored in session, not exposed)
- File size limits (16MB max)

## Customization Options

### AI Prompts
You can modify the AI prompts in `app.py` to adjust the customization behavior:
- Located in the `generate_ai_customization` method
- Customize instruction tone and focus areas
- Adjust output format requirements
- You can also alternatively customize the prompts with placeholders provided within the UI (Click 'Advanced')

### UI Styling
- Tailwind CSS classes can be modified in `templates/index.html`
- Custom CSS in the `<style>` section
- Alpine.js reactive components for dynamic behavior

## Troubleshooting

### Common Issues

1. **File Upload Fails**
   - Ensure file is in DOCX format (if your file is .doc, please save as .docx first)
   - Check file size (must be under 16MB)
   - Verify file is not corrupted

2. **AI Customization Errors**
   - Verify API key is valid and active
   - Check Google AI Studio quota limits
   - Ensure job description is not empty

3. **PDF Generation Issues**
   - Check that customizations were generated successfully
   - Ensure filename contains valid characters
   - Verify disk space for temporary files
   - Ensure you have MS Word installed on the machine

### Error Messages
- The application provides clear error messages for common issues
- Check browser console for detailed error information
- Server logs contain detailed error traces

## Future Enhancements

- Support for additional AI providers (OpenAI, Claude)
- Batch processing for multiple job applications
- Resume scoring and optimization suggestions
- Integration with job boards and ATS systems

## License

This project is open source and available under the MIT License.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.

## Support

For support and questions, please open an issue in the repository or contact the development team.
