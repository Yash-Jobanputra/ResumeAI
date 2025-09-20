from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from datetime import datetime

db = SQLAlchemy()
migrate = Migrate()

class Resume(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    resume_name = db.Column(db.String(150), nullable=False)
    original_file_path = db.Column(db.String(300), nullable=False)
    created_date = db.Column(db.DateTime, default=datetime.utcnow)
    user_session_id = db.Column(db.String(100), nullable=False)
    selected_paragraph_ids = db.Column(db.JSON)
    user_first_name = db.Column(db.String(100))
    user_last_name = db.Column(db.String(100))
    structured_text = db.Column(db.JSON)
    applications = db.relationship('Application', backref='resume', lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            'id': self.id,
            'resume_name': self.resume_name,
            'original_file_path': self.original_file_path,
            'created_date': self.created_date.isoformat(),
            'user_session_id': self.user_session_id,
            'selected_paragraph_ids': self.selected_paragraph_ids,
            'user_first_name': self.user_first_name,
            'user_last_name': self.user_last_name,
        }

class Application(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    company_name = db.Column(db.String(150), nullable=False)
    job_description = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(50), default='not_applied')
    match_score = db.Column(db.Integer)
    cover_letter = db.Column(db.Text)
    customized_paragraphs = db.Column(db.JSON)
    interview_prep = db.Column(db.JSON)
    created_date = db.Column(db.DateTime, default=datetime.utcnow)
    updated_date = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user_session_id = db.Column(db.String(100), nullable=False)
    resume_id = db.Column(db.Integer, db.ForeignKey('resume.id'), nullable=False)
    job_posting_url = db.Column(db.String(500), nullable=True)  # URL to original job posting

    def to_dict(self):
        return {
            'id': self.id,
            'company_name': self.company_name,
            'job_description': self.job_description,
            'status': self.status,
            'match_score': self.match_score,
            'cover_letter': self.cover_letter,
            'customized_paragraphs': self.customized_paragraphs,
            'interview_prep': self.interview_prep,
            'created_date': self.created_date.isoformat(),
            'updated_date': self.updated_date.isoformat(),
            'user_session_id': self.user_session_id,
            'resume_id': self.resume_id,
            'resume_name': self.resume.resume_name if self.resume else 'N/A',
            'job_posting_url': self.job_posting_url
        }

# New Model for scraped job descriptions from the extension
class ScrapedJD(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    job_title = db.Column(db.String(250), nullable=False)
    company_name = db.Column(db.String(150), nullable=False)
    job_description = db.Column(db.Text, nullable=True)
    page_url = db.Column(db.String(500), nullable=False)
    created_date = db.Column(db.DateTime, default=datetime.utcnow)
    user_session_id = db.Column(db.String(100), nullable=False)
    status = db.Column(db.String(50), default='active')  # 'active' or 'generated'

    def to_dict(self):
        return {
            'id': self.id,
            'job_title': self.job_title,
            'company_name': self.company_name,
            'job_description': self.job_description,
            'page_url': self.page_url,
            'created_date': self.created_date.isoformat(),
            'user_session_id': self.user_session_id,
            'status': self.status,
        }
