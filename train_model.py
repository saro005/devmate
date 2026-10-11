import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import SAGEConv, to_hetero
from models import init_db, SessionLocal, User, Skill, collaborations
from sentence_transformers import SentenceTransformer
from torch_geometric.data import HeteroData

class GNNEncoder(nn.Module):
    def __init__(self, hidden_channels, out_channels):
        super().__init__()
        self.conv1 = SAGEConv((-1, -1), hidden_channels)
        self.conv2 = SAGEConv((-1, -1), out_channels)

    def forward(self, x, edge_index):
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        x = F.dropout(x, p=0.2, training=self.training)
        x = self.conv2(x, edge_index)
        return x

class LinkPredictor(nn.Module):
    def __init__(self, in_channels):
        super().__init__()
        self.lin1 = nn.Linear(in_channels * 2, 64)
        self.lin2 = nn.Linear(64, 1)

    def forward(self, x_src, x_dst):
        if x_src.dim() == 1:
            x_src = x_src.unsqueeze(0)
        if x_dst.dim() == 1:
            x_dst = x_dst.unsqueeze(0)
        h = torch.cat([x_src, x_dst], dim=-1)
        h = F.relu(self.lin1(h))
        return self.lin2(h).squeeze(-1)

class TeamMatcherGNN(nn.Module):
    def __init__(self, hidden_channels, out_channels, metadata):
        super().__init__()
        self.encoder = to_hetero(GNNEncoder(hidden_channels, out_channels), metadata, aggr='sum')
        self.predictor = LinkPredictor(out_channels)

    def forward(self, x_dict, edge_index_dict):
        z_dict = self.encoder(x_dict, edge_index_dict)
        return z_dict

def train_and_save():
    init_db()
    db = SessionLocal()
    users = db.query(User).order_by(User.id).all()
    skills = db.query(Skill).order_by(Skill.id).all()

    sentence_model = SentenceTransformer('all-MiniLM-L6-v2')
    data = HeteroData()

    data['skill'].x = torch.eye(len(skills), dtype=torch.float)
    user_feats = []
    for u in users:
        emb = sentence_model.encode(u.bio)
        user_feats.append(list(emb) + [u.exp / 10.0])
    data['user'].x = torch.tensor(user_feats, dtype=torch.float)

    skill_map = {s.name: s.id - 1 for s in skills}
    src_u, dst_s = [], []
    for u in users:
        for s in u.skills:
            src_u.append(u.id - 1)
            dst_s.append(skill_map[s.name])

    data['user', 'has_skill', 'skill'].edge_index = torch.tensor([src_u, dst_s], dtype=torch.long)
    data['skill', 'rev_has_skill', 'user'].edge_index = torch.tensor([dst_s, src_u], dtype=torch.long)

    collab_rows = db.execute(collaborations.select()).fetchall()
    if collab_rows:
        collab_src = [r[0] - 1 for r in collab_rows]
        collab_dst = [r[1] - 1 for r in collab_rows]
        data['user', 'collaborated_with', 'user'].edge_index = torch.tensor([collab_src, collab_dst], dtype=torch.long)
    else:
        data['user', 'collaborated_with', 'user'].edge_index = torch.empty((2, 0), dtype=torch.long)

    model = TeamMatcherGNN(hidden_channels=64, out_channels=32, metadata=data.metadata())
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)

    print("Training Heterogeneous GNN on realistic builder graph...")
    model.train()
    for epoch in range(1, 101):
        optimizer.zero_grad()
        z_dict = model(data.x_dict, data.edge_index_dict)
        u_emb = z_dict['user']

        # BPR Loss on existing collaborations or high skill overlap
        edge_index = data['user', 'collaborated_with', 'user'].edge_index
        if edge_index.size(1) > 0:
            pos_src, pos_dst = edge_index[0], edge_index[1]
            pos_score = model.predictor(u_emb[pos_src], u_emb[pos_dst])
            neg_dst = (pos_dst + 1) % u_emb.size(0)
            neg_score = model.predictor(u_emb[pos_src], u_emb[neg_dst])
            loss = -torch.log(torch.sigmoid(pos_score - neg_score) + 1e-8).mean()
        else:
            loss = torch.tensor(0.0, requires_grad=True)

        loss.backward()
        optimizer.step()
        if epoch % 25 == 0:
            print(f"Epoch {epoch:03d} | Loss: {loss.item():.4f}")

    torch.save(model.state_dict(), "gnn_model.pt")
    print("Exported updated gnn_model.pt successfully!")
    db.close()

if __name__ == "__main__":
    train_and_save()