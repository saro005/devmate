from sqlalchemy import create_engine, Column, Integer, String, Float, ForeignKey, Table, Text, DateTime
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from datetime import datetime

DATABASE_URL = "sqlite:///./matcher.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

user_skills = Table(
    "user_skills",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
    Column("skill_id", Integer, ForeignKey("skills.id"), primary_key=True),
)

collaborations = Table(
    "collaborations",
    Base.metadata,
    Column("user_1_id", Integer, ForeignKey("users.id"), primary_key=True),
    Column("user_2_id", Integer, ForeignKey("users.id"), primary_key=True),
)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    role = Column(String(100), nullable=False)
    bio = Column(Text, nullable=False)
    exp = Column(Float, default=1.0)

    skills = relationship("Skill", secondary=user_skills, back_populates="users")
    collaborators = relationship(
        "User",
        secondary=collaborations,
        primaryjoin=id == collaborations.c.user_1_id,
        secondaryjoin=id == collaborations.c.user_2_id,
    )

class Skill(Base):
    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    users = relationship("User", secondary=user_skills, back_populates="skills")

class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"))
    receiver_id = Column(Integer, ForeignKey("users.id"))
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)

class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    project_pair = Column(String(50), index=True)
    title = Column(String(200), nullable=False)
    assigned_to = Column(String(100), nullable=False)
    assigned_user_id = Column(Integer, nullable=True)
    fit_score = Column(Float, default=85.0)
    skill_tag = Column(String(50), default="General")
    depends_on_id = Column(Integer, nullable=True)  # DAG prerequisite task ID
    status = Column(String(20), default="todo")     # "todo", "blocked", "done"

class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    reviewer_id = Column(Integer, ForeignKey("users.id"))
    reviewed_id = Column(Integer, ForeignKey("users.id"))
    rating = Column(Integer, nullable=False)
    feedback = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

def init_db():
    Base.metadata.create_all(bind=engine)