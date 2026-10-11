import torch
import torch.nn.functional as F
from sentence_transformers import SentenceTransformer
from models import SessionLocal, init_db
from train_model import TeamMatcherGNN
from main import build_graph_from_db

def retrain():
    init_db()
    db = SessionLocal()

    import main
    main.sentence_model = SentenceTransformer('all-MiniLM-L6-v2')
    graph = build_graph_from_db(db)
    db.close()

    print(f"Building GNN with skill dimension: {graph['skill'].x.size(1)}")

    model = TeamMatcherGNN(hidden_channels=64, out_channels=32, metadata=graph.metadata())

    with torch.no_grad():
        model(graph.x_dict, graph.edge_index_dict)

    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)

    model.train()
    print("Training GNN on database graph...")
    for epoch in range(1, 51):
        optimizer.zero_grad()
        z_dict = model(graph.x_dict, graph.edge_index_dict)
        user_emb = z_dict['user']

        collab_edges = graph['user', 'collaborated_with', 'user'].edge_index
        if collab_edges.size(1) > 0:
            src = collab_edges[0]
            dst = collab_edges[1]
            pos_scores = model.predictor(user_emb[src], user_emb[dst])

            num_users = user_emb.size(0)
            neg_dst = (dst + 1) % num_users
            neg_scores = model.predictor(user_emb[src], user_emb[neg_dst])

            loss = -torch.log(torch.sigmoid(pos_scores - neg_scores) + 1e-8).mean()
        else:
            loss = torch.tensor(0.0, requires_grad=True)

        loss.backward()
        optimizer.step()

    model.eval()
    torch.save(model.state_dict(), "gnn_model.pt")
    print("Saved fresh gnn_model.pt matching the database dimension successfully!")

if __name__ == "__main__":
    retrain()