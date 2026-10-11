import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import CytoscapeComponent from 'react-cytoscapejs';
import { 
  Sparkles, Zap, UserPlus, X, MessageSquare, Send, 
  CheckSquare, ArrowLeft, Share2, Compass, Star, LogOut, LogIn, User,
  Lock, CheckCircle, Plus, GitBranch, Code2, Layers, Cpu, Award,
  Activity, Clock, Hash, CheckCircle2, AlertCircle, Users
} from 'lucide-react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:8000'
  : `http://${window.location.hostname}:8000`;

const WS_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'ws://127.0.0.1:8000'
  : `ws://${window.location.hostname}:8000`;

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('gnn_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [loginHandle, setLoginHandle] = useState('');
  const [authError, setAuthError] = useState('');
  const [activeTab, setActiveTab] = useState('matcher');
  const [availableSkills, setAvailableSkills] = useState([]);
  const [matchData, setMatchData] = useState(null);
  const [graphElements, setGraphElements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);

  // Workspace & PM state
  const [activeWorkspacePartner, setActiveWorkspacePartner] = useState(null);
  const [workspaceData, setWorkspaceData] = useState({ tasks: [], messages: [], reviewed_rating: null });
  const [chatInput, setChatInput] = useState('');
  const [selectedRating, setSelectedRating] = useState(5);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  // Smart task form state
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskSkill, setNewTaskSkill] = useState('');
  const [newTaskDep, setNewTaskDep] = useState('');

  const roomWsRef = useRef(null);

  const [registerForm, setRegisterForm] = useState({
    username: '',
    name: '',
    role: '',
    bio: '',
    exp: 2.0,
    skills: []
  });

  const fetchSkills = () => {
    axios.get(`${API_BASE}/api/skills`).then(res => setAvailableSkills(res.data)).catch(console.error);
  };

  const fetchGraph = () => {
    axios.get(`${API_BASE}/api/graph-view`).then(res => setGraphElements(res.data.elements)).catch(console.error);
  };

  const fetchMatches = () => {
    if (!currentUser) return;
    setLoading(true);
    axios.get(`${API_BASE}/api/matches/${currentUser.id}`)
      .then(res => {
        setMatchData(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  const reloadWorkspace = () => {
    if (!activeWorkspacePartner || !currentUser) return;
    axios.get(`${API_BASE}/api/workspace/${currentUser.id}/${activeWorkspacePartner.user_id}`)
      .then(res => {
        setWorkspaceData(res.data);
        if (res.data.reviewed_rating) {
          setSelectedRating(res.data.reviewed_rating);
          setReviewSubmitted(true);
        } else {
          setReviewSubmitted(false);
        }
      });
  };

  useEffect(() => {
    fetchSkills();
    fetchGraph();

    const feedWs = new WebSocket(`${WS_BASE}/ws/feed`);
    feedWs.onmessage = (evt) => {
      const payload = JSON.parse(evt.data);
      if (payload.type === 'NEW_USER_JOINED' || payload.type === 'CONNECTION_FORMED') {
        fetchMatches();
        fetchGraph();
      }
    };

    return () => feedWs.close();
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('gnn_user', JSON.stringify(currentUser));
      fetchMatches();
      setActiveWorkspacePartner(null);
    } else {
      localStorage.removeItem('gnn_user');
      setMatchData(null);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!activeWorkspacePartner || !currentUser) return;
    const roomId = [Math.min(currentUser.id, activeWorkspacePartner.user_id), Math.max(currentUser.id, activeWorkspacePartner.user_id)].join('_');

    reloadWorkspace();

    const ws = new WebSocket(`${WS_BASE}/ws/${roomId}`);
    roomWsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'TASK_UPDATED') {
        reloadWorkspace();
      } else {
        setWorkspaceData(prev => ({
          ...prev,
          messages: [...prev.messages, msg]
        }));
      }
    };

    return () => ws.close();
  }, [activeWorkspacePartner, currentUser]);

  const handleLogin = (e) => {
    e.preventDefault();
    setAuthError('');
    axios.post(`${API_BASE}/api/auth/login`, { username: loginHandle })
      .then(res => {
        setCurrentUser(res.data);
        setLoginHandle('');
      })
      .catch(err => setAuthError(err.response?.data?.detail || 'Login failed'));
  };

  const handleLogout = () => {
    setCurrentUser(null);
  };

  const handleRegister = (e) => {
    e.preventDefault();
    setAuthError('');
    axios.post(`${API_BASE}/api/users`, registerForm)
      .then(res => {
        setIsRegisterOpen(false);
        setRegisterForm({ username: '', name: '', role: '', bio: '', exp: 2.0, skills: [] });
        setCurrentUser(res.data.user);
      })
      .catch(err => setAuthError(err.response?.data?.detail || 'Registration failed'));
  };

  const handleConnect = (targetUserId) => {
    if (!currentUser) return;
    axios.post(`${API_BASE}/api/connect`, {
      user_id_1: currentUser.id,
      user_id_2: targetUserId
    }).then(() => {
      fetchMatches();
      fetchGraph();
    }).catch(console.error);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !roomWsRef.current || !currentUser) return;

    const payload = {
      sender_id: currentUser.id,
      receiver_id: activeWorkspacePartner.user_id,
      content: chatInput
    };

    roomWsRef.current.send(JSON.stringify(payload));
    setChatInput('');
  };

  const handleCreateSmartTask = (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !currentUser || !activeWorkspacePartner) return;

    const roomId = [Math.min(currentUser.id, activeWorkspacePartner.user_id), Math.max(currentUser.id, activeWorkspacePartner.user_id)].join('_');

    axios.post(`${API_BASE}/api/tasks/smart-create`, {
      project_pair: roomId,
      title: newTaskTitle,
      user_ids: [currentUser.id, activeWorkspacePartner.user_id],
      skill_tag: newTaskSkill || 'Engineering',
      depends_on_id: newTaskDep ? parseInt(newTaskDep) : null
    }).then(() => {
      setNewTaskTitle('');
      setNewTaskSkill('');
      setNewTaskDep('');
      reloadWorkspace();
    }).catch(console.error);
  };

  const handleToggleTaskStatus = (task) => {
    const nextStatus = task.status === 'done' ? 'todo' : 'done';
    axios.patch(`${API_BASE}/api/tasks/${task.id}/status`, { status: nextStatus })
      .then(() => reloadWorkspace())
      .catch(console.error);
  };

  const handleSynergyReview = () => {
    if (!currentUser || !activeWorkspacePartner) return;
    axios.post(`${API_BASE}/api/reviews`, {
      reviewer_id: currentUser.id,
      reviewed_id: activeWorkspacePartner.user_id,
      rating: selectedRating,
      feedback: "Collaboration review"
    }).then(() => {
      setReviewSubmitted(true);
      fetchMatches();
    }).catch(console.error);
  };

  const cytoscapeStylesheet = [
    {
      selector: 'node[type="user"]',
      style: {
        'background-color': '#38bdf8',
        'label': 'data(label)',
        'color': '#ffffff',
        'font-size': '12px',
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'width': 32,
        'height': 32
      }
    },
    {
      selector: 'node[type="skill"]',
      style: {
        'background-color': '#a855f7',
        'label': 'data(label)',
        'color': '#cbd5e1',
        'font-size': '11px',
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'width': 22,
        'height': 22
      }
    },
    {
      selector: 'edge[label="has_skill"]',
      style: {
        'width': 1.5,
        'line-color': '#475569',
        'curve-style': 'bezier'
      }
    },
    {
      selector: 'edge[label="collaborated"]',
      style: {
        'width': 2.5,
        'line-color': '#22c55e',
        'line-style': 'dashed',
        'curve-style': 'bezier'
      }
    }
  ];

  if (!currentUser) {
    return (
      <div style={{ width: '100%', minHeight: '85vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: '480px', padding: '32px', background: '#1e293b', borderRadius: '20px', border: '1px solid #334155', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            {/* Logo Badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', background: 'linear-gradient(135deg, #0f172a, #1e293b)', padding: '10px 18px', borderRadius: '28px', border: '1px solid #38bdf844', marginBottom: '14px' }}>
              <div style={{ background: 'linear-gradient(135deg, #38bdf8, #818cf8)', padding: '8px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 12px rgba(56, 189, 248, 0.4)' }}>
                <Cpu size={22} color="#0f172a" strokeWidth={2.5} />
              </div>
              <span style={{ fontSize: '20px', fontWeight: '900', letterSpacing: '-0.5px', background: 'linear-gradient(90deg, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                DevMate
              </span>
            </div>
            <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#f8fafc', margin: '0 0 6px 0' }}>Sign In to Network</h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>Discover optimal team chemistry via multi-hop link prediction.</p>
          </div>

          {authError && (
            <div style={{ background: '#ef444422', border: '1px solid #ef4444', color: '#fca5a5', padding: '12px', borderRadius: '10px', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={16} /> {authError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '13px', color: '#cbd5e1', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <User size={15} color="#38bdf8" /> Developer Username
              </label>
              <input
                type="text"
                placeholder="e.g. alice, bob, or diana"
                value={loginHandle}
                onChange={e => setLoginHandle(e.target.value)}
                required
                style={{ width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', padding: '12px', color: '#fff', fontSize: '14px' }}
              />
            </div>
            <button type="submit" style={{ background: '#38bdf8', color: '#0f172a', border: 'none', padding: '12px', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px' }}>
              <LogIn size={18} /> Enter DevMate
            </button>
          </form>

          <div style={{ margin: '24px 0', textAlign: 'center', borderTop: '1px solid #334155', position: 'relative' }}>
            <span style={{ position: 'absolute', top: '-10px', background: '#1e293b', padding: '0 10px', color: '#94a3b8', fontSize: '12px', left: '50%', transform: 'translateX(-50%)' }}>or</span>
          </div>

          <button
            onClick={() => { setAuthError(''); setIsRegisterOpen(true); }}
            style={{ width: '100%', background: '#22c55e', color: '#0f172a', border: 'none', padding: '12px', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px' }}
          >
            <UserPlus size={18} /> Create Developer Profile
          </button>

          {isRegisterOpen && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '520px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Code2 size={20} color="#38bdf8" />
                    <h2 style={{ fontSize: '20px', fontWeight: '800', margin: 0 }}>Register Developer Node</h2>
                  </div>
                  <X size={20} onClick={() => setIsRegisterOpen(false)} style={{ cursor: 'pointer', color: '#94a3b8' }} />
                </div>
                <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input type="text" placeholder="Username (e.g. saravanan)" value={registerForm.username} onChange={e => setRegisterForm({...registerForm, username: e.target.value})} required style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '10px', color: '#fff' }} />
                  <input type="text" placeholder="Full Name" value={registerForm.name} onChange={e => setRegisterForm({...registerForm, name: e.target.value})} required style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '10px', color: '#fff' }} />
                  <input type="text" placeholder="Role (e.g. Full-Stack Engineer)" value={registerForm.role} onChange={e => setRegisterForm({...registerForm, role: e.target.value})} required style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '10px', color: '#fff' }} />
                  <textarea placeholder="Bio & Tech Stack" value={registerForm.bio} onChange={e => setRegisterForm({...registerForm, bio: e.target.value})} required rows={3} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '10px', color: '#fff' }} />
                  <div style={{ fontSize: '13px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Layers size={14} /> Select Core Competencies:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {availableSkills.map(skill => (
                      <span key={skill} onClick={() => setRegisterForm(p => ({ ...p, skills: p.skills.includes(skill) ? p.skills.filter(s => s !== skill) : [...p.skills, skill]}))} style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '16px', cursor: 'pointer', background: registerForm.skills.includes(skill) ? '#38bdf8' : '#0f172a', color: registerForm.skills.includes(skill) ? '#0f172a' : '#94a3b8', border: '1px solid #334155' }}>
                        {skill}
                      </span>
                    ))}
                  </div>
                  <button type="submit" style={{ background: '#38bdf8', color: '#0f172a', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', marginTop: '8px', fontSize: '14px' }}>
                    Register & Enter Network
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: '1400px', margin: '0 auto', padding: '24px 32px', boxSizing: 'border-box' }}>
      {/* Top Navbar Header */}
      <div style={{ background: '#1e293b', padding: '16px 24px', borderRadius: '16px', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #334155', flexWrap: 'wrap', gap: '16px' }}>
        {/* Brand Logo Corner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: 'linear-gradient(135deg, #38bdf8, #818cf8)', padding: '10px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 15px rgba(56, 189, 248, 0.45)' }}>
              <Cpu size={24} color="#0f172a" strokeWidth={2.5} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '-0.5px', background: 'linear-gradient(90deg, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  DevMate
                </span>
                <span style={{ fontSize: '10px', background: '#0f172a', color: '#38bdf8', padding: '2px 8px', borderRadius: '12px', border: '1px solid #334155', fontWeight: '700' }}>
                  GNN CORE
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>AI Multi-Hop Partner Matcher</div>
            </div>
          </div>

          <div style={{ height: '32px', width: '1px', background: '#334155' }}></div>

          {/* Current User Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: '#38bdf822', color: '#38bdf8', padding: '8px', borderRadius: '50%' }}>
              <User size={18} />
            </div>
            <div>
              <div style={{ fontWeight: '800', fontSize: '14px', color: '#f8fafc' }}>
                {currentUser.name} <span style={{ color: '#94a3b8', fontWeight: '400', fontSize: '12px' }}>@{currentUser.username}</span>
              </div>
              <div style={{ fontSize: '12px', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Award size={12} /> {currentUser.role} • Exp: {currentUser.exp}
              </div>
            </div>
          </div>
        </div>

        {/* Global Navigation Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setActiveTab('matcher')}
            style={{
              background: activeTab === 'matcher' ? '#38bdf8' : '#0f172a',
              color: activeTab === 'matcher' ? '#0f172a' : '#94a3b8',
              border: '1px solid #334155',
              padding: '8px 16px',
              borderRadius: '10px',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '14px'
            }}
          >
            <Compass size={16} /> Partner Discovery
          </button>
          <button
            onClick={() => { setActiveTab('graph'); fetchGraph(); }}
            style={{
              background: activeTab === 'graph' ? '#38bdf8' : '#0f172a',
              color: activeTab === 'graph' ? '#0f172a' : '#94a3b8',
              border: '1px solid #334155',
              padding: '8px 16px',
              borderRadius: '10px',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '14px'
            }}
          >
            <Share2 size={16} /> 2D Topology Graph
          </button>
          <button
            onClick={handleLogout}
            style={{
              background: '#ef444422',
              color: '#fca5a5',
              border: '1px solid #ef444444',
              padding: '8px 14px',
              borderRadius: '10px',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '14px'
            }}
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>

      {/* Main Body */}
      {activeTab === 'graph' ? (
        <div style={{ background: '#1e293b', borderRadius: '20px', border: '1px solid #334155', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', fontSize: '13px', color: '#94a3b8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#38bdf8', fontWeight: '600' }}><Users size={14} /> Developers</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#a855f7', fontWeight: '600' }}><Layers size={14} /> Skills</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#22c55e', fontWeight: '600' }}><GitBranch size={14} /> Collaborations</span>
            </div>
            <button onClick={fetchGraph} style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Activity size={14} /> Refresh Graph Layout
            </button>
          </div>
          <div style={{ height: '620px', background: '#0f172a', borderRadius: '14px', overflow: 'hidden' }}>
            <CytoscapeComponent
              elements={graphElements}
              style={{ width: '100%', height: '100%' }}
              layout={{ name: 'cose', animate: false, padding: 40 }}
              stylesheet={cytoscapeStylesheet}
            />
          </div>
        </div>
      ) : activeWorkspacePartner ? (
        /* Workspace View */
        <div style={{ background: '#1e293b', borderRadius: '20px', border: '1px solid #334155', padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #334155', paddingBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button onClick={() => setActiveWorkspacePartner(null)} style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '15px', fontWeight: '600' }}>
                <ArrowLeft size={20} /> Back to Matches
              </button>
              <h2 style={{ fontSize: '22px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <GitBranch size={22} color="#38bdf8" /> {currentUser.name} & {activeWorkspacePartner.name}
              </h2>
            </div>
            <span style={{ fontSize: '13px', background: '#0f172a', padding: '6px 14px', borderRadius: '8px', color: '#4ade80', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Activity size={14} /> Live Multi-Hop Sprint
            </span>
          </div>

          {/* Feedback Bar */}
          <div style={{ background: '#0f172a', padding: '16px 20px', borderRadius: '12px', border: '1px solid #334155', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <div style={{ fontWeight: '800', fontSize: '15px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Star size={16} color="#facc15" /> Team Synergy & Feedback
              </div>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>Rate this collaboration to fine-tune the GNN link predictor weights online.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {[1, 2, 3, 4, 5].map(star => (
                <Star
                  key={star}
                  size={22}
                  onClick={() => !reviewSubmitted && setSelectedRating(star)}
                  style={{ cursor: reviewSubmitted ? 'default' : 'pointer', color: star <= selectedRating ? '#facc15' : '#475569', fill: star <= selectedRating ? '#facc15' : 'transparent' }}
                />
              ))}
              <button
                onClick={handleSynergyReview}
                disabled={reviewSubmitted}
                style={{ marginLeft: '12px', background: reviewSubmitted ? '#334155' : '#38bdf8', color: reviewSubmitted ? '#94a3b8' : '#0f172a', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: reviewSubmitted ? 'default' : 'pointer' }}
              >
                {reviewSubmitted ? 'Synced & Retrained' : 'Submit Review'}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '24px' }}>
            {/* DAG Task Engine */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#0f172a', padding: '20px', borderRadius: '14px', border: '1px solid #334155' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckSquare size={18} color="#38bdf8" /> Autonomous Milestone DAG Allocation
                </h3>

                {/* Create Task Form */}
                <form onSubmit={handleCreateSmartTask} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
                  <input
                    type="text"
                    placeholder="Milestone description (e.g. Build GraphQL Resolvers & Mutation APIs)..."
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    required
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '12px', color: '#fff', fontSize: '13px' }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Skill Tag (e.g. GraphQL, FastAPI)"
                      value={newTaskSkill}
                      onChange={e => setNewTaskSkill(e.target.value)}
                      style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '10px 12px', color: '#fff', fontSize: '13px' }}
                    />
                    <select
                      value={newTaskDep}
                      onChange={e => setNewTaskDep(e.target.value)}
                      style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '10px 12px', color: '#94a3b8', fontSize: '13px' }}
                    >
                      <option value="">No Prerequisite (Starts Ready)</option>
                      {workspaceData.tasks.map(t => (
                        <option key={t.id} value={t.id}>Requires Task #{t.id}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" style={{ background: '#22c55e', color: '#0f172a', border: 'none', padding: '10px', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <Plus size={16} /> Auto-Analyze & Allocate Task
                  </button>
                </form>

                {/* Milestones List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto' }}>
                  {workspaceData.tasks.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: '#64748b', fontSize: '13px' }}>
                      No sprint tasks created yet. Enter a milestone above to let DevMate allocate it.
                    </div>
                  ) : (
                    workspaceData.tasks.map(t => (
                      <div
                        key={t.id}
                        style={{
                          background: '#1e293b',
                          padding: '14px 16px',
                          borderRadius: '10px',
                          border: '1px solid',
                          borderColor: t.status === 'blocked' ? '#ef444444' : t.status === 'done' ? '#22c55e44' : '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          opacity: t.status === 'blocked' ? 0.65 : 1.0
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {t.status === 'blocked' && <Lock size={15} color="#f87171" />}
                            {t.status === 'done' && <CheckCircle2 size={15} color="#4ade80" />}
                            <span style={{ fontWeight: '700', fontSize: '14px', textDecoration: t.status === 'done' ? 'line-through' : 'none', color: '#f8fafc' }}>
                              #{t.id} {t.title}
                            </span>
                          </div>
                          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '5px' }}>
                            Assigned: <strong style={{ color: '#38bdf8' }}>{t.assigned_to}</strong> ({t.fit_score}% GNN Fit)
                            <span style={{ marginLeft: '8px', background: '#0f172a', padding: '2px 8px', borderRadius: '6px', color: '#e2e8f0' }}>{t.skill_tag}</span>
                            {t.depends_on_id && <span style={{ marginLeft: '8px', color: '#fca5a5' }}>[Requires #{t.depends_on_id}]</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => handleToggleTaskStatus(t)}
                          disabled={t.status === 'blocked'}
                          style={{
                            background: t.status === 'done' ? '#22c55e' : '#334155',
                            color: t.status === 'done' ? '#0f172a' : '#94a3b8',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: '700',
                            cursor: t.status === 'blocked' ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          {t.status === 'blocked' ? <Lock size={13} /> : t.status === 'done' ? <CheckCircle size={13} /> : <Clock size={13} />}
                          {t.status === 'blocked' ? 'Blocked' : t.status === 'done' ? 'Completed' : 'Mark Done'}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Live Chat */}
            <div style={{ background: '#0f172a', padding: '20px', borderRadius: '14px', border: '1px solid #334155', display: 'flex', flexDirection: 'column', height: '560px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageSquare size={18} color="#38bdf8" /> Real-Time Sprint Chat
              </h3>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px', paddingRight: '4px' }}>
                {workspaceData.messages.map((m, idx) => {
                  const isMe = m.sender_id === currentUser.id;
                  return (
                    <div key={idx} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', background: isMe ? '#38bdf8' : '#1e293b', color: isMe ? '#0f172a' : '#f8fafc', padding: '8px 14px', borderRadius: '12px', fontSize: '13px', maxWidth: '80%', lineHeight: '1.4' }}>
                      {m.content}
                    </div>
                  );
                })}
              </div>
              <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Chat with teammate..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '10px 12px', color: '#fff', fontSize: '13px' }}
                />
                <button type="submit" style={{ background: '#38bdf8', color: '#0f172a', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer' }}>
                  <Send size={16} />
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        /* Discovery Feed */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '18px' }}>
          {loading ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
              Computing personalized GNN recommendations...
            </div>
          ) : matchData?.top_matches.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px', color: '#94a3b8', background: '#1e293b', borderRadius: '16px' }}>
              No other candidates registered yet. Open another tab or device and create a new profile!
            </div>
          ) : (
            matchData?.top_matches.map((match) => (
              <div key={match.user_id} style={{ background: '#1e293b', borderRadius: '16px', padding: '22px', border: '1px solid #334155', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '14px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#f8fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <User size={18} color="#38bdf8" /> {match.name} <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '400' }}>@{match.username}</span>
                    </h3>
                    <span style={{ fontSize: '12px', background: '#0f172a', padding: '3px 10px', borderRadius: '6px', color: '#94a3b8', border: '1px solid #334155', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Code2 size={12} /> {match.role}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '10px 0' }}>
                    {match.skills.map((skill, i) => (
                      <span key={i} style={{ fontSize: '12px', background: '#334155', padding: '3px 10px', borderRadius: '20px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Hash size={11} color="#38bdf8" /> {skill}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', color: '#4ade80' }}>
                    <Zap size={15} />
                    <span><strong>Complementary:</strong> {match.complementary_skills.join(', ')}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #334155', paddingTop: '14px', marginTop: '6px' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>GNN Link Match</span>
                    <span style={{ fontSize: '24px', fontWeight: '900', color: match.match_score >= 80 ? '#4ade80' : '#38bdf8' }}>
                      {match.match_score}%
                    </span>
                  </div>
                  {match.is_connected ? (
                    <button
                      onClick={() => setActiveWorkspacePartner(match)}
                      style={{ background: '#22c55e', color: '#0f172a', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <GitBranch size={15} /> Sprint Room
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(match.user_id)}
                      style={{ background: '#38bdf8', color: '#0f172a', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Plus size={15} /> Connect
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}