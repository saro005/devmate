from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
import torch
import torch.nn.functional as F
import json
from sentence_transformers import SentenceTransformer
from torch_geometric.data import HeteroData

from models import init_db, SessionLocal, User, Skill, Message, Task, Review, collaborations
from train_model import TeamMatcherGNN

app = FastAPI(title="GNN Partner Matcher & Project PM API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

data = None
model = None
user_embeddings = None
sentence_model = None

class LoginRequest(BaseModel):
    username: str

class NewUserRequest(BaseModel):
    username: str
    name: str
    role: str
    bio: str
    skills: List[str]
    exp: float

class ConnectRequest(BaseModel):
    user_id_1: int
    user_id_2: int

class SmartTaskRequest(BaseModel):
    project_pair: str
    title: str
    user_ids: List[int]
    skill_tag: Optional[str] = "General"
    depends_on_id: Optional[int] = None

class TaskStatusUpdate(BaseModel):
    status: str

class ReviewRequest(BaseModel):
    reviewer_id: int
    reviewed_id: int
    rating: int
    feedback: Optional[str] = ""

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def build_graph_from_db(db: Session):
    graph = HeteroData()
    users = db.query(User).order_by(User.id).all()
    skills = db.query(Skill).order_by(Skill.id).all()
    
    num_skills = len(skills)
    skill_map = {s.name: s.id - 1 for s in skills}
    
    graph['skill'].x = torch.eye(num_skills, dtype=torch.float)
    
    user_feats = []
    for u in users:
        emb = sentence_model.encode(u.bio)
        user_feats.append(list(emb) + [u.exp / 10.0])
    graph['user'].x = torch.tensor(user_feats, dtype=torch.float)
    
    src_u, dst_s = [], []
    for u in users:
        for s in u.skills:
            src_u.append(u.id - 1)
            dst_s.append(skill_map[s.name])
            
    if src_u:
        graph['user', 'has_skill', 'skill'].edge_index = torch.tensor([src_u, dst_s], dtype=torch.long)
        graph['skill', 'rev_has_skill', 'user'].edge_index = torch.tensor([dst_s, src_u], dtype=torch.long)
    else:
        graph['user', 'has_skill', 'skill'].edge_index = torch.empty((2, 0), dtype=torch.long)
        graph['skill', 'rev_has_skill', 'user'].edge_index = torch.empty((2, 0), dtype=torch.long)

    collab_rows = db.execute(collaborations.select()).fetchall()
    if collab_rows:
        collab_src = [r[0] - 1 for r in collab_rows]
        collab_dst = [r[1] - 1 for r in collab_rows]
        graph['user', 'collaborated_with', 'user'].edge_index = torch.tensor([collab_src, collab_dst], dtype=torch.long)
    else:
        graph['user', 'collaborated_with', 'user'].edge_index = torch.empty((2, 0), dtype=torch.long)
        
    return graph

def recompute_embeddings():
    global user_embeddings
    with torch.no_grad():
        z_dict = model(data.x_dict, data.edge_index_dict)
        user_embeddings = z_dict['user']

def fine_tune_gnn_online(pos_src: int, pos_dst: int, rating: int):
    global model, data
    if data['user'].x.size(0) < 2:
        return
        
    model.train()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.005)
    weight_factor = (rating - 2.5) / 2.5
    
    for _ in range(15):
        optimizer.zero_grad()
        z_dict = model(data.x_dict, data.edge_index_dict)
        u_emb = z_dict['user']
        pos_score = model.predictor(u_emb[pos_src], u_emb[pos_dst])
        
        num_users = u_emb.size(0)
        neg_dst = (pos_dst + 1) % num_users
        if neg_dst == pos_src:
            neg_dst = (neg_dst + 1) % num_users
            
        neg_score = model.predictor(u_emb[pos_src], u_emb[neg_dst])
        
        if weight_factor >= 0:
            loss = -torch.log(torch.sigmoid(pos_score - neg_score) + 1e-8) * (1.0 + weight_factor)
        else:
            loss = -torch.log(torch.sigmoid(neg_score - pos_score) + 1e-8) * abs(weight_factor)
            
        loss.backward()
        optimizer.step()
        
    model.eval()
    torch.save(model.state_dict(), "gnn_model.pt")
    recompute_embeddings()

@app.on_event("startup")
def startup_event():
    global data, model, sentence_model
    init_db()
    sentence_model = SentenceTransformer('all-MiniLM-L6-v2')
    
    db = SessionLocal()
    data = build_graph_from_db(db)
    db.close()
    
    model = TeamMatcherGNN(hidden_channels=64, out_channels=32, metadata=data.metadata())
    with torch.no_grad():
        model(data.x_dict, data.edge_index_dict)
    
    model.load_state_dict(torch.load("gnn_model.pt", map_location=torch.device('cpu')))
    model.eval()
    recompute_embeddings()
    print("Database, PM DAG Engine & GNN Matcher Ready!")

class ConnectionManager:
    def __init__(self):
        self.active_rooms: Dict[str, List[WebSocket]] = {}
        self.feed_listeners: List[WebSocket] = []

    async def connect_room(self, room: str, websocket: WebSocket):
        await websocket.accept()
        if room not in self.active_rooms:
            self.active_rooms[room] = []
        self.active_rooms[room].append(websocket)

    def disconnect_room(self, room: str, websocket: WebSocket):
        if room in self.active_rooms and websocket in self.active_rooms[room]:
            self.active_rooms[room].remove(websocket)

    async def broadcast_room(self, room: str, message: dict):
        if room in self.active_rooms:
            for connection in self.active_rooms[room]:
                await connection.send_text(json.dumps(message))

    async def connect_feed(self, websocket: WebSocket):
        await websocket.accept()
        self.feed_listeners.append(websocket)

    def disconnect_feed(self, websocket: WebSocket):
        if websocket in self.feed_listeners:
            self.feed_listeners.remove(websocket)

    async def broadcast_feed(self, event_type: str, payload: dict = None):
        msg = json.dumps({"type": event_type, "data": payload or {}})
        for ws in self.feed_listeners:
            try:
                await ws.send_text(msg)
            except Exception:
                pass

manager = ConnectionManager()

@app.websocket("/ws/feed")
async def feed_websocket(websocket: WebSocket):
    await manager.connect_feed(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_feed(websocket)

@app.websocket("/ws/{room_id}")
async def workspace_websocket(websocket: WebSocket, room_id: str):
    await manager.connect_room(room_id, websocket)
    try:
        while True:
            text = await websocket.receive_text()
            payload = json.loads(text)
            
            db = SessionLocal()
            msg = Message(
                sender_id=payload["sender_id"] + 1,
                receiver_id=payload["receiver_id"] + 1,
                content=payload["content"]
            )
            db.add(msg)
            db.commit()
            db.close()
            
            await manager.broadcast_room(room_id, payload)
    except WebSocketDisconnect:
        manager.disconnect_room(room_id, websocket)

@app.post("/api/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username.strip().lower()).first()
    if not user:
        raise HTTPException(status_code=404, detail="User handle not found. Please register.")
    return {
        "id": user.id - 1,
        "username": user.username,
        "name": user.name,
        "role": user.role,
        "bio": user.bio,
        "skills": [s.name for s in user.skills],
        "exp": user.exp
    }

@app.get("/api/users")
def get_all_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    return [{
        "id": u.id - 1,
        "username": u.username,
        "name": u.name,
        "role": u.role,
        "bio": u.bio,
        "skills": [s.name for s in u.skills],
        "exp": u.exp,
        "collaborator_ids": [c.id - 1 for c in u.collaborators]
    } for u in users]

@app.get("/api/skills")
def get_skills(db: Session = Depends(get_db)):
    return [s.name for s in db.query(Skill).all()]

@app.post("/api/users")
async def register_user(user_req: NewUserRequest, db: Session = Depends(get_db)):
    global data
    clean_username = user_req.username.strip().lower()
    existing = db.query(User).filter(User.username == clean_username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists. Choose another.")

    db_skills = db.query(Skill).filter(Skill.name.in_(user_req.skills)).all()
    new_user = User(
        username=clean_username,
        name=user_req.name,
        role=user_req.role,
        bio=user_req.bio,
        exp=user_req.exp,
        skills=db_skills
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    data = build_graph_from_db(db)
    recompute_embeddings()

    user_payload = {
        "id": new_user.id - 1,
        "username": new_user.username,
        "name": new_user.name,
        "role": new_user.role,
        "bio": new_user.bio,
        "skills": [s.name for s in new_user.skills],
        "exp": new_user.exp
    }

    await manager.broadcast_feed("NEW_USER_JOINED", user_payload)
    return {"message": "User registered!", "user": user_payload}

@app.post("/api/connect")
async def connect_users(req: ConnectRequest, db: Session = Depends(get_db)):
    global data
    u1 = db.query(User).filter(User.id == req.user_id_1 + 1).first()
    u2 = db.query(User).filter(User.id == req.user_id_2 + 1).first()
    
    if not u1 or not u2:
        raise HTTPException(status_code=404, detail="User not found")
        
    u1.collaborators.append(u2)
    u2.collaborators.append(u1)
    
    # Auto-initialize baseline sprint with a DAG dependency
    p_pair = f"{min(req.user_id_1, req.user_id_2)}_{max(req.user_id_1, req.user_id_2)}"
    t1 = Task(
        project_pair=p_pair,
        title=f"Core Data Models & Architecture ({u1.role})",
        assigned_to=u1.name,
        assigned_user_id=req.user_id_1,
        fit_score=94.5,
        skill_tag="Architecture",
        status="todo"
    )
    db.add(t1)
    db.commit()
    db.refresh(t1)

    t2 = Task(
        project_pair=p_pair,
        title=f"User Interface & Feature Flow ({u2.role})",
        assigned_to=u2.name,
        assigned_user_id=req.user_id_2,
        fit_score=91.0,
        skill_tag="Frontend",
        depends_on_id=t1.id,  # Blocked until t1 completes
        status="blocked"
    )
    db.add(t2)
    db.commit()

    data = build_graph_from_db(db)
    recompute_embeddings()

    await manager.broadcast_feed("CONNECTION_FORMED", {"user_1": req.user_id_1, "user_2": req.user_id_2})
    return {"message": "Connected! Project sprint initialized."}

@app.get("/api/workspace/{user1_id}/{user2_id}")
def get_workspace_data(user1_id: int, user2_id: int, db: Session = Depends(get_db)):
    p_pair = f"{min(user1_id, user2_id)}_{max(user1_id, user2_id)}"
    tasks = db.query(Task).filter(Task.project_pair == p_pair).all()
    
    msgs = db.query(Message).filter(
        ((Message.sender_id == user1_id + 1) & (Message.receiver_id == user2_id + 1)) |
        ((Message.sender_id == user2_id + 1) & (Message.receiver_id == user1_id + 1))
    ).order_by(Message.timestamp).all()

    rev = db.query(Review).filter(
        (Review.reviewer_id == user1_id + 1) & (Review.reviewed_id == user2_id + 1)
    ).first()
    
    return {
        "tasks": [{
            "id": t.id,
            "title": t.title,
            "assigned_to": t.assigned_to,
            "assigned_user_id": t.assigned_user_id,
            "fit_score": t.fit_score,
            "skill_tag": t.skill_tag,
            "depends_on_id": t.depends_on_id,
            "status": t.status
        } for t in tasks],
        "messages": [{"sender_id": m.sender_id - 1, "content": m.content} for m in msgs],
        "reviewed_rating": rev.rating if rev else None
    }

# --- SMART GNN-FIT TASK CREATION ---
@app.post("/api/tasks/smart-create")
async def create_smart_task(req: SmartTaskRequest, db: Session = Depends(get_db)):
    # 1. Embed task objective via Sentence-Transformers
    task_emb = sentence_model.encode(req.title)
    task_tensor = torch.tensor(task_emb, dtype=torch.float)

    # 2. Score affinity against each candidate teammate's embedding
    best_uid = None
    best_score = -1.0

    for uid in req.user_ids:
        # Compare text bio embedding of user against task
        user_obj = db.query(User).filter(User.id == uid + 1).first()
        if user_obj:
            user_bio_emb = sentence_model.encode(user_obj.bio + " " + " ".join([s.name for s in user_obj.skills]))
            user_tensor = torch.tensor(user_bio_emb, dtype=torch.float)
            sim = F.cosine_similarity(task_tensor.unsqueeze(0), user_tensor.unsqueeze(0)).item()
            score = round((sim + 1.0) / 2.0 * 100, 1) # Normalize to 0-100%
            if score > best_score:
                best_score = score
                best_uid = uid

    assigned_user = db.query(User).filter(User.id == best_uid + 1).first()
    
    # Check if prerequisite is already done
    initial_status = "todo"
    if req.depends_on_id:
        parent = db.query(Task).filter(Task.id == req.depends_on_id).first()
        if parent and parent.status != "done":
            initial_status = "blocked"

    new_task = Task(
        project_pair=req.project_pair,
        title=req.title,
        assigned_to=assigned_user.name if assigned_user else "Unassigned",
        assigned_user_id=best_uid,
        fit_score=best_score,
        skill_tag=req.skill_tag,
        depends_on_id=req.depends_on_id,
        status=initial_status
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)

    # Broadcast task addition to workspace room
    await manager.broadcast_room(req.project_pair, {"type": "TASK_UPDATED"})
    return {"message": "Smart task created", "task_id": new_task.id, "assigned_to": new_task.assigned_to, "fit": best_score}

# --- TASK STATUS TRANSITION & DAG UNBLOCKING ---
@app.patch("/api/tasks/{task_id}/status")
async def update_task_status(task_id: int, req: TaskStatusUpdate, db: Session = Depends(get_db)):
    global data
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = req.status

    # If marked DONE, unblock all tasks that were waiting on this task
    if req.status == "done":
        dependent_tasks = db.query(Task).filter(Task.depends_on_id == task_id).all()
        for dep in dependent_tasks:
            dep.status = "todo"

        # Boost developer experience node on task completion
        assigned_user = db.query(User).filter(User.id == task.assigned_user_id + 1).first()
        if assigned_user:
            assigned_user.exp = round(assigned_user.exp + 0.2, 2)
            db.commit()
            data = build_graph_from_db(db)
            recompute_embeddings()

    db.commit()
    await manager.broadcast_room(task.project_pair, {"type": "TASK_UPDATED"})
    return {"message": "Task updated and dependencies unblocked"}

@app.post("/api/reviews")
def submit_synergy_review(req: ReviewRequest, bg_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    review = Review(
        reviewer_id=req.reviewer_id + 1,
        reviewed_id=req.reviewed_id + 1,
        rating=req.rating,
        feedback=req.feedback
    )
    db.add(review)
    db.commit()

    bg_tasks.add_task(fine_tune_gnn_online, req.reviewer_id, req.reviewed_id, req.rating)
    return {"message": "Review recorded. GNN model fine-tuning started!"}

@app.get("/api/matches/{user_id}")
def get_matches(user_id: int, db: Session = Depends(get_db)):
    target_user = db.query(User).filter(User.id == user_id + 1).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
        
    all_users = db.query(User).all()
    target_skills = set([s.name for s in target_user.skills])
    target_emb = user_embeddings[user_id]
    collab_ids = [c.id - 1 for c in target_user.collaborators]
    
    recommendations = []
    for candidate in all_users:
        cand_id = candidate.id - 1
        if cand_id == user_id:
            continue
            
        cand_emb = user_embeddings[cand_id]
        raw_score = torch.sigmoid(model.predictor(target_emb, cand_emb)).item()
        match_score = round(raw_score * 100, 1)
        
        cand_skills = set([s.name for s in candidate.skills])
        complementary = list(cand_skills - target_skills)
        shared = list(cand_skills.intersection(target_skills))
        
        recommendations.append({
            "user_id": cand_id,
            "username": candidate.username,
            "name": candidate.name,
            "role": candidate.role,
            "match_score": match_score,
            "is_connected": cand_id in collab_ids,
            "skills": [s.name for s in candidate.skills],
            "complementary_skills": complementary if complementary else ["General Synergy"],
            "shared_skills": shared
        })
        
    recommendations.sort(key=lambda x: x["match_score"], reverse=True)
    return {
        "user": {
            "id": user_id,
            "username": target_user.username,
            "name": target_user.name,
            "role": target_user.role,
            "skills": [s.name for s in target_user.skills]
        },
        "top_matches": recommendations
    }

@app.get("/api/graph-view")
def get_graph_visualization_data(db: Session = Depends(get_db)):
    users = db.query(User).all()
    skills = db.query(Skill).all()
    
    nodes = []
    edges = []
    
    for u in users:
        nodes.append({
            "data": {
                "id": f"u_{u.id - 1}",
                "label": f"{u.name} (@{u.username})",
                "type": "user",
                "role": u.role
            }
        })
        
    for s in skills:
        nodes.append({
            "data": {
                "id": f"s_{s.name}",
                "label": s.name,
                "type": "skill"
            }
        })
        
    for u in users:
        for s in u.skills:
            edges.append({
                "data": {
                    "source": f"u_{u.id - 1}",
                    "target": f"s_{s.name}",
                    "label": "has_skill"
                }
            })
            
    collab_rows = db.execute(collaborations.select()).fetchall()
    seen_collabs = set()
    for r in collab_rows:
        src, dst = sorted([r[0] - 1, r[1] - 1])
        if (src, dst) not in seen_collabs:
            seen_collabs.add((src, dst))
            edges.append({
                "data": {
                    "source": f"u_{src}",
                    "target": f"u_{dst}",
                    "label": "collaborated"
                }
            })
            
    return {"elements": nodes + edges}