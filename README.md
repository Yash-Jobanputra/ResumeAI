# ResumeAI

> 🚧 **Extension instructions are WIP and will be added soon.**

## Overview

ResumeAI is an AI-powered resume builder and analyzer that leverages large language models to help users transform and tailor resumes and cover letters for specific job applications.

---

## Setup Instructions

1. **Install Memurai**
   - Download and install Memurai from [https://www.memurai.com/download](https://www.memurai.com/download).
   - Memurai should already be started up. Double check by opening command prompt and pasting this:
     ```sh
     memurai-cli ping
     ```
  - Expected output should be PONG
     

2. **Download or Clone ResumeAI**
   - **Download ZIP:**  
     Go to [https://github.com/Yash-Jobanputra/ResumeAI](https://github.com/Yash-Jobanputra/ResumeAI), click the green **Code** button, and select **Download ZIP**. Unzip to a folder.
   - **Or Clone:**  
     ```sh
     git clone https://github.com/Yash-Jobanputra/ResumeAI.git
     cd ResumeAI
     ```

3. **Remove Database File**
   - Delete the old database file to start fresh by navigating to instances folder

4. **Update .env With Your Gemini API Key**
   - Open the `.env` file in the main folder.
   - Add or update this line with your [Google Gemini API key](https://aistudio.google.com/app/apikey):
     ```
     GEMINI_API_KEY=your_google_gemini_api_key_here
     ```
   - OPTIONALLY, add a secret key for Flask sessions:
     ```
     SECRET_KEY=your_flask_secret_key_here
     ```

5. **Run Celery Worker**
   - On Windows, double-click or run the provided `.bat` file (`start_celery.bat`) to start the Celery worker.
   - Wait a bit for the worker to start.

6. **Run the Application**
   - In your terminal, run:
     ```sh
     python app.py
     ```
   - The app will start on `127.0.0.1:5001`.
   - You can also just double click to launch but this will not show any errors at execution, if any.

---

## AI Prompt Instructions

ResumeAI's AI prompt logic is in the `ResumeProcessor` class in `app.py`.  
Future version will have this within the UI, if you are still keen to change it atm then edit the following methods to change how the AI customizes resumes and cover letters:

- `_generate_paragraphs`
- `_generate_cover_letter`


Change the instructions, guidelines, or output format as needed. Ensure you keep the placeholders:
 - For _generate_paragraphs:
  - company_name, job_description, selected_paragraph_ids, resume_data['full_text']
    - If editing single paragraph placeholder, use resume_data['paragraphs']
 - For _generate_cover_letter:
    - company_name
    - resume_data['full_text']
    - job_description
Outputs need not be changed. 

---

## Extensions (WIP)

> 🚧 **Instructions for the extension are coming soon!**

---

## Troubleshooting

- **Memurai/Redis not running:** Make sure Memurai is installed and running.
- **API errors:** Check your `.env` for a valid Gemini API key.
- **Database issues:** Delete `instance/resumeai.db` and restart the app.
- **Celery not working:** Make sure you ran the `.bat` file and waited a bit before starting `app.py`.

---

## License

See [LICENSE](LICENSE) for more details.

---

**Readme was generated with  ChatGPT**
- 
