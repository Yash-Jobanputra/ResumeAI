from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from datetime import datetime
from sqlalchemy.orm import joinedload, selectinload

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
    file_hash = db.Column(db.String(64))  # SHA-256 hash of file for cache invalidation
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
    job_title = db.Column(db.String(250), nullable=True)  # Job title from scraped job posting
    job_description = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(50), default='not_applied')
    match_score = db.Column(db.Integer)
    match_score_analysis = db.Column(db.Text)  # New field for match score analysis
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
            'job_title': self.job_title,
            'job_description': self.job_description,
            'status': self.status,
            'match_score': self.match_score,
            'match_score_analysis': self.match_score_analysis,  # New field
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

    @classmethod
    def get_with_resume(cls, session_id):
        """Optimized query to get applications with resume data in one query"""
        return cls.query.options(
            joinedload(cls.resume)
        ).filter_by(
            user_session_id=session_id
        ).order_by(
            cls.created_date.desc()
        ).all()

# New Model for scraped job descriptions from the extension
class ScrapedJD(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    job_title = db.Column(db.String(250), nullable=False)
    company_name = db.Column(db.String(150), nullable=False)
    job_description = db.Column(db.Text, nullable=True)
    page_url = db.Column(db.String(500), nullable=False)
    application_type = db.Column(db.String(50), default='Normal')  # 'Normal' or 'Easy Apply'
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
            'application_type': self.application_type,
            'created_date': self.created_date.isoformat(),
            'user_session_id': self.user_session_id,
            'status': self.status,
        }

# New Model for tracking background jobs to fix regeneration bug
class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    celery_job_id = db.Column(db.String(100), nullable=False, unique=True)  # Celery task ID
    job_type = db.Column(db.String(50), nullable=False)  # 'customization', 'interview_prep', 'download'
    status = db.Column(db.String(50), default='pending')  # 'pending', 'processing', 'completed', 'failed'
    result_id = db.Column(db.String(100), nullable=True)  # ID of the original result for regeneration
    parent_job_id = db.Column(db.Integer, db.ForeignKey('job.id'), nullable=True)  # For regeneration jobs
    user_session_id = db.Column(db.String(100), nullable=False)
    resume_id = db.Column(db.Integer, db.ForeignKey('resume.id'), nullable=True)
    company_name = db.Column(db.String(150), nullable=True)
    job_description = db.Column(db.Text, nullable=True)
    regenerate_type = db.Column(db.JSON, nullable=True)  # Type of regeneration (paragraphs, cover_letter, etc.)
    error_message = db.Column(db.Text, nullable=True)
    created_date = db.Column(db.DateTime, default=datetime.utcnow)
    started_date = db.Column(db.DateTime, nullable=True)
    completed_date = db.Column(db.DateTime, nullable=True)
    result_data = db.Column(db.JSON, nullable=True)  # Store result when completed

    # Relationships
    resume = db.relationship('Resume', backref='jobs')
    parent_job = db.relationship('Job', remote_side=[id])

    def to_dict(self):
        return {
            'id': self.id,
            'celery_job_id': self.celery_job_id,
            'job_type': self.job_type,
            'status': self.status,
            'result_id': self.result_id,
            'parent_job_id': self.parent_job_id,
            'user_session_id': self.user_session_id,
            'resume_id': self.resume_id,
            'company_name': self.company_name,
            'job_description': self.job_description,
            'regenerate_type': self.regenerate_type,
            'error_message': self.error_message,
            'created_date': self.created_date.isoformat() if self.created_date else None,
            'started_date': self.started_date.isoformat() if self.started_date else None,
            'completed_date': self.completed_date.isoformat() if self.completed_date else None,
            'result_data': self.result_data,
        }

    @classmethod
    def get_by_celery_id(cls, celery_job_id):
        """Get job by Celery task ID"""
        return cls.query.filter_by(celery_job_id=celery_job_id).first()

    @classmethod
    def get_active_jobs(cls, user_session_id):
        """Get all active (non-completed) jobs for a user session"""
        return cls.query.filter_by(
            user_session_id=user_session_id,
            status__in=['pending', 'processing']
        ).order_by(cls.created_date.desc()).all()

    @classmethod
    def get_completed_jobs(cls, user_session_id):
        """Get all completed jobs for a user session"""
        return cls.query.filter_by(
            user_session_id=user_session_id,
            status='completed'
        ).order_by(cls.completed_date.desc()).all()
