from models import init_db, SessionLocal, User, Skill

def seed_data():
    init_db()
    db = SessionLocal()

    if db.query(User).count() > 0:
        print("Database already seeded.")
        db.close()
        return

    print("Seeding database with usernames...")

    skill_names = ["Python", "PyTorch", "React", "FastAPI", "UI/UX", "Java", "Docker", "PostgreSQL"]
    skills = {name: Skill(name=name) for name in skill_names}
    for s in skills.values():
        db.add(s)
    db.commit()

    u0 = User(username="alice", name="Alice", role="Backend Engineer", bio="Backend developer specializing in Python, FastAPI, and Docker", exp=3.0)
    u0.skills = [skills["Python"], skills["FastAPI"], skills["Docker"]]

    u1 = User(username="bob", name="Bob", role="Frontend Designer", bio="Frontend designer passionate about React, UI/UX, and animations", exp=2.0)
    u1.skills = [skills["React"], skills["UI/UX"]]

    u2 = User(username="charlie", name="Charlie", role="ML Engineer", bio="ML engineer working with PyTorch, GNNs, and Python", exp=4.0)
    u2.skills = [skills["Python"], skills["PyTorch"], skills["Docker"]]

    u3 = User(username="diana", name="Diana", role="Full-Stack Dev", bio="Full-stack engineer using React, Java, and PostgreSQL", exp=2.5)
    u3.skills = [skills["React"], skills["Java"], skills["PostgreSQL"]]

    db.add_all([u0, u1, u2, u3])
    db.commit()

    u0.collaborators.append(u1)
    u1.collaborators.append(u0)
    db.commit()

    print("Seeded successfully!")
    db.close()

if __name__ == "__main__":
    seed_data()