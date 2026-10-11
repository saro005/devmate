import torch
from torch_geometric.data import HeteroData
from sentence_transformers import SentenceTransformer

def create_mock_graph():
    print("1. Initializing HeteroData graph...")
    data = HeteroData()
    model = SentenceTransformer('all-MiniLM-L6-v2')

    # Define mock skills
    skills_list = ["Python", "PyTorch", "React", "FastAPI", "UI/UX", "Java", "Docker", "PostgreSQL"]
    skill_to_idx = {skill: i for i, skill in enumerate(skills_list)}
    
    # Skill node features (Identity / One-hot embeddings)
    data['skill'].x = torch.eye(len(skills_list), dtype=torch.float)

    # Define mock users
    mock_users = [
        {"name": "Alice", "bio": "Backend developer specializing in Python, FastAPI, and Docker", "exp": 3.0, "skills": ["Python", "FastAPI", "Docker"]},
        {"name": "Bob", "bio": "Frontend designer passionate about React, UI/UX, and animations", "exp": 2.0, "skills": ["React", "UI/UX"]},
        {"name": "Charlie", "bio": "ML engineer working with PyTorch, GNNs, and Python", "exp": 4.0, "skills": ["Python", "PyTorch", "Docker"]},
        {"name": "Diana", "bio": "Full-stack engineer using React, Java, and PostgreSQL", "exp": 2.5, "skills": ["React", "Java", "PostgreSQL"]},
    ]

    # Generate user node feature vectors: Text embedding (384) + Normalized experience (1) = 385 dims
    user_embeddings = []
    user_skills_edges = [[], []]

    for u_idx, user in enumerate(mock_users):
        bio_emb = model.encode(user["bio"])
        feat = list(bio_emb) + [user["exp"] / 10.0]  # Normalize experience
        user_embeddings.append(feat)

        for skill in user["skills"]:
            user_skills_edges[0].append(u_idx)
            user_skills_edges[1].append(skill_to_idx[skill])

    data['user'].x = torch.tensor(user_embeddings, dtype=torch.float)
    
    # Edge: user -> has_skill -> skill
    data['user', 'has_skill', 'skill'].edge_index = torch.tensor(user_skills_edges, dtype=torch.long)
    
    # Edge: skill -> rev_has_skill -> user (needed for two-way message passing)
    data['skill', 'rev_has_skill', 'user'].edge_index = torch.tensor([user_skills_edges[1], user_skills_edges[0]], dtype=torch.long)

    # Add mock collaboration edges: Alice (0) worked with Bob (1)
    collab_edges = [[0, 1], [1, 0]]
    data['user', 'collaborated_with', 'user'].edge_index = torch.tensor(collab_edges, dtype=torch.long)

    print("Graph built successfully!")
    print(data)
    return data

if __name__ == "__main__":
    create_mock_graph()