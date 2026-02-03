import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Camera, Package, ArrowRightLeft, Users, Plus, Search, X, CheckCircle, AlertCircle, Barcode, History, LayoutDashboard, Pencil, Trash2, Sparkles, MessageSquare, Send, Loader2, Copy, FileSpreadsheet, Upload, FileUp, Wrench, FileText, ExternalLink, AlertTriangle, Shield, UserCog, LogOut, Lock, Mail, Key, User, IdCard, Database, Wifi } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  deleteUser,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc,
  getDocs,
  setDoc, 
  addDoc,
  updateDoc, 
  deleteDoc,
  onSnapshot, 
  serverTimestamp,
  query,
  orderBy,
  writeBatch
} from 'firebase/firestore';


// OpenRouter key removed — use secret `OPENROUTER_API_KEY` in Cloudflare Pages Functions (do NOT commit keys)
// --- Firebase Configuration & Initialization ---
const firebaseConfig = {
  apiKey: "AIzaSyDHpydyd3zPnnYwfLJlUXvA4-SihGF00P8",
  authDomain: "anhs-asb-app.firebaseapp.com",
  projectId: "anhs-asb-app",
  storageBucket: "anhs-asb-app.firebasestorage.app",
  messagingSenderId: "450951399140",
  appId: "1:450951399140:web:3d4ce0c8c2ff2066dd8ef1",
  measurementId: "G-1V38FFBB6S"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Enable persistence to keep users logged in across refreshes
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Persistence error:", error);
});

// STABLE STORAGE ID
const appId = 'anhs-inventory';

// --- Constants & Helpers ---
const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  NORMAL: 'normal'
};

const getRoleLabel = (role) => {
  switch(role) {
    case ROLES.SUPER_ADMIN: return 'Super Admin';
    case ROLES.ADMIN: return 'Admin';
    default: return 'User';
  }
};

const getPermissions = (role) => ({
  canManageInventory: [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role),
  canManageUsers: role === ROLES.SUPER_ADMIN,
  canCheckOutForOthers: [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role),
  canSeeAdminStats: [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role)
});

// --- OpenRouter Proxy Helper (calls Pages Function at /api/openrouter) ---
const callGemini = async (prompt, systemInstruction = "", jsonMode = false) => {
  const url = "/api/openrouter";

  const messages = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  messages.push({ role: 'user', content: prompt });

  const payload = {
    model: "openrouter/free",
    messages
  };

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (let i = 0; i < 3; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
        const err = new Error(`OpenRouter Proxy Error: ${response.status}`);
        err.status = response.status;
        err.body = parsed;
        throw err;
      }

      const data = await response.json();

      // Try to extract text content in several possible shapes
      let content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';

      // If content is an object with parts (compat for other formats), turn into string
      if (typeof content === 'object') {
        if (Array.isArray(content.parts) && content.parts.length) {
          content = content.parts.map(p => (typeof p === 'string' ? p : (p.text || ''))).join('');
        } else {
          try {
            content = JSON.stringify(content);
          } catch (e) {
            content = String(content);
          }
        }
      }

      // For JSON-mode callers we return a JSON string (keeps compatibility with existing callers that do JSON.parse(res))
      if (jsonMode) {
        try {
          const parsed = typeof content === 'string' ? JSON.parse(content) : content;
          return JSON.stringify(parsed);
        } catch (e) {
          return content;
        }
      }

      return content || '';
    } catch (err) {
      // Don't retry on 405 Method Not Allowed — it's a proxy configuration issue
      if (err?.status === 405) throw err;
      if (i === 2) throw err;
      await delay(1000 * Math.pow(2, i)); // Backoff: 1s, 2s, 4s
    }
  }
};

// --- Components ---

// 1. Authentication Screen (Login / Sign Up)
const AuthScreen = ({ onLogin, onSignup }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    // Timeout safety
    const timeout = setTimeout(() => {
        if(isSubmitting) {
            setIsSubmitting(false);
            setError("Request timed out. Please check your connection.");
        }
    }, 15000);
    
    try {
      if (isLogin) {
        await onLogin(email, password);
      } else {
        if (!name || !employeeId) {
          throw new Error("Please fill in all fields.");
        }
        await onSignup(email, password, name, employeeId);
      }
    } catch (err) {
      console.error("Auth error details:", err);
      let msg = "Authentication failed: " + err.message;
      if (err.code === 'auth/invalid-credential') msg = "Invalid email or password.";
      if (err.code === 'auth/user-not-found') msg = "No account found with this email.";
      if (err.code === 'auth/wrong-password') msg = "Incorrect password.";
      if (err.code === 'auth/email-already-in-use') msg = "Email already in use. Try logging in.";
      if (err.code === 'auth/weak-password') msg = "Password should be at least 6 characters.";
      if (err.code === 'auth/network-request-failed') msg = "Network error. Please check your connection.";
      if (err.code === 'permission-denied') msg = "Database permission denied. Check Firestore Rules.";
      if (err.code === 'auth/operation-not-allowed') msg = "Email/Password sign-in is disabled in Firebase Console.";
      
      setError(msg);
    } finally {
      clearTimeout(timeout);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white max-w-md w-full rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-300">
        <div className="bg-blue-600 p-6 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-white mx-auto mb-4 backdrop-blur-sm">
            <Package size={32} />
          </div>
          <h1 className="text-2xl font-bold text-white">AssetTrack</h1>
          <p className="text-blue-100 text-sm mt-1">Inventory Management System</p>
        </div>

        <div className="p-8">
          <div className="flex gap-4 mb-6 border-b border-gray-100 pb-2">
            <button 
              onClick={() => { setIsLogin(true); setError(''); }}
              className={`flex-1 pb-2 text-sm font-medium transition-colors ${isLogin ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Login
            </button>
            <button 
              onClick={() => { setIsLogin(false); setError(''); }}
              className={`flex-1 pb-2 text-sm font-medium transition-colors ${!isLogin ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 text-gray-400" size={18} />
                    <input 
                      type="text" 
                      required={!isLogin}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder="Jane Doe"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Employee ID</label>
                  <div className="relative">
                    <IdCard className="absolute left-3 top-3 text-gray-400" size={18} />
                    <input 
                      type="text" 
                      required={!isLogin}
                      value={employeeId}
                      onChange={(e) => setEmployeeId(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder="ID-12345"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="jane@company.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
                <AlertTriangle className="flex-shrink-0" size={16} /> <span className="break-words w-full">{error}</span>
              </div>
            )}

            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-blue-200 transition-all active:scale-95 flex justify-center mt-6"
            >
              {isSubmitting ? <Loader2 className="animate-spin" /> : (isLogin ? 'Login' : 'Create Account')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// 2. User Management (Super Admin)
const UserManagement = ({ currentUser }) => {
  const [users, setUsers] = useState([]);
  
  useEffect(() => {
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  const updateUserRole = async (targetUserId, newRole) => {
    if (targetUserId === currentUser.id) {
      alert("You cannot change your own role."); 
      return;
    }
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', targetUserId), {
        role: newRole,
        lastUpdated: serverTimestamp()
      });
    } catch (error) {
      console.error("Failed to update role", error);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-4">
      <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <UserCog size={20} className="text-blue-600" /> User Management
        </h2>
        <span className="text-xs font-mono bg-blue-100 text-blue-700 px-2 py-1 rounded">Super Admin Only</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-white text-gray-500 text-xs uppercase font-semibold border-b border-gray-100">
            <tr>
              <th className="px-6 py-4">User</th>
              <th className="px-6 py-4">ID</th>
              <th className="px-6 py-4">Role</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="font-medium text-gray-900">{u.name}</div>
                  <div className="text-xs text-gray-400">{u.email}</div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600 font-mono">
                  {u.employeeId || '-'}
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                    ${u.role === ROLES.SUPER_ADMIN ? 'bg-purple-100 text-purple-800' : 
                      u.role === ROLES.ADMIN ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                    {getRoleLabel(u.role)}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <select 
                    value={u.role}
                    onChange={(e) => updateUserRole(u.id, e.target.value)}
                    disabled={u.id === currentUser.id}
                    className="text-sm border-gray-200 rounded-lg p-1 bg-white border focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value={ROLES.NORMAL}>User</option>
                    <option value={ROLES.ADMIN}>Admin</option>
                    <option value={ROLES.SUPER_ADMIN}>Super Admin</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// 3. Scanner Component
const BarcodeScanner = ({ onScan, onClose }) => {
  const [error, setError] = useState(null);
  const scannerRef = useRef(null);

  useEffect(() => {
    if (!window.Html5QrcodeScanner) {
      const script = document.createElement('script');
      script.src = "https://unpkg.com/html5-qrcode";
      script.async = true;
      script.onload = initScanner;
      document.body.appendChild(script);
    } else {
      initScanner();
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
      }
    };
  }, []);

  const initScanner = () => {
    if (!window.Html5QrcodeScanner) {
      setError("Failed to load scanner library.");
      return;
    }

    try {
      const scanner = new window.Html5QrcodeScanner(
        "reader",
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
        false
      );
      scanner.render((decodedText) => { onScan(decodedText); scanner.clear(); }, () => {});
      scannerRef.current = scanner;
    } catch (err) {
      setError("Camera permission denied or not available.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl overflow-hidden relative">
        <div className="p-4 bg-gray-900 text-white flex justify-between items-center">
          <h3 className="font-semibold flex items-center gap-2"><Camera size={18} /> Scan Barcode</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-full"><X size={20} /></button>
        </div>
        <div className="p-4 bg-gray-100 min-h-[300px] flex flex-col justify-center">
           <div id="reader" className="w-full"></div>
           {error && <div className="text-red-500 text-center mt-4 p-2 bg-red-50 rounded">{error}</div>}
           <p className="text-center text-xs text-gray-500 mt-4">Point camera at an asset tag or barcode</p>
        </div>
      </div>
    </div>
  );
};

// 4. Stat Card
const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
    <div className={`p-3 rounded-lg ${color}`}><Icon size={24} className="text-white" /></div>
    <div><p className="text-sm text-gray-500 font-medium">{title}</p><h4 className="text-2xl font-bold text-gray-800">{value}</h4></div>
  </div>
);

// 5. Delete Confirmation Modal
const DeleteConfirmModal = ({ item, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
    <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full animate-in fade-in zoom-in duration-200">
      <div className="flex items-center gap-3 text-red-600 mb-4">
        <AlertCircle size={24} />
        <h3 className="text-lg font-bold text-gray-900">Delete Asset?</h3>
      </div>
      <p className="text-gray-500 mb-6">
        Are you sure you want to delete <strong>{item.name}</strong>? This action cannot be undone.
      </p>
      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg">Cancel</button>
        <button onClick={() => onConfirm(item.id)} className="px-4 py-2 bg-red-600 text-white font-medium hover:bg-red-700 rounded-lg">Delete</button>
      </div>
    </div>
  </div>
);

// 6. Ask AI Modal
const AskAIModal = ({ inventory, onClose, onAIError }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleAsk = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;

    setIsLoading(true);
    try {
      const simplifiedInventory = inventory.map(i => ({
        id: i.id,
        name: i.name,
        status: i.condition === 'broken' ? 'Broken/Unavailable' : i.status,
        assignedTo: i.assignedTo,
        category: i.category || 'Uncategorized',
        manualUrl: i.manualUrl ? 'Available' : 'None'
      }));

      const systemPrompt = `You are an intelligent inventory assistant. You have access to the following asset data: ${JSON.stringify(simplifiedInventory)}. Answer the user's question accurately based strictly on this data. If the answer isn't in the data, say so. Keep answers concise.`;
      
      const response = await callGemini(question, systemPrompt, false);
      setAnswer(response);
    } catch (err) {
      console.error(err);
      if (err?.status === 405) {
        onAIError?.({ status: err.status, message: 'OpenRouter proxy returned 405 Method Not Allowed', details: err.body || err.message });
        setAnswer('AI service unavailable (Method Not Allowed). Please check server-side proxy configuration.');
      } else {
        onAIError?.({ status: err?.status || 0, message: 'AI request failed', details: err?.body || err?.message });
        setAnswer("Sorry, I couldn't process that request right now.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in duration-200">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-indigo-600 text-white">
          <h2 className="font-bold flex items-center gap-2"><Sparkles size={18} /> Ask AI about Inventory</h2>
          <button onClick={onClose} className="p-1 hover:bg-indigo-500 rounded-full"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
           {answer ? (
             <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-4">
               <div className="flex items-start gap-3">
                 <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600 mt-1"><Sparkles size={16} /></div>
                 <div className="prose prose-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{answer}</div>
               </div>
             </div>
           ) : (
             <div className="text-center text-gray-400 py-8">
               <MessageSquare size={48} className="mx-auto mb-3 opacity-20" />
               <p>Ask questions like:<br/>"Who has item #LP-001?"<br/>"Which items are broken?"<br/>"Do we have manuals for the cameras?"</p>
             </div>
           )}
        </div>

        <form onSubmit={handleAsk} className="p-4 bg-white border-t border-gray-100 flex gap-2">
          <input 
            type="text" 
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            autoFocus
          />
          <button 
            type="submit" 
            disabled={isLoading || !question.trim()}
            className="bg-indigo-600 text-white p-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
          </button>
        </form>
      </div>
    </div>
  );
};

// 7. CSV Import Modal
const CSVImportModal = ({ onClose, onImport, onAIError }) => {
  const [preview, setPreview] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [autoGen, setAutoGen] = useState(false);
  const [statusText, setStatusText] = useState('');

  const processFile = (file) => {
    if (!file) return;
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      setError('Please upload a valid CSV file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const rows = text.split('\n').map(row => row.split(','));
        const headers = rows[0].map(h => h.trim().toLowerCase());
        
        if (!headers.includes('id') || !headers.includes('name')) {
          setError('CSV must contain "id" and "name" columns.');
          return;
        }

        const idIdx = headers.indexOf('id');
        const nameIdx = headers.indexOf('name');
        const catIdx = headers.indexOf('category');
        const descIdx = headers.indexOf('description');

        const data = rows.slice(1).filter(r => r.length > 1 && r[idIdx]).map(row => ({
          id: row[idIdx]?.trim(),
          name: row[nameIdx]?.trim(),
          category: catIdx > -1 ? row[catIdx]?.trim() : '',
          description: descIdx > -1 ? row[descIdx]?.trim() : '',
          status: 'available',
          condition: 'good',
          lastUpdated: serverTimestamp()
        }));

        setPreview(data);
        setError('');
      } catch (err) {
        setError('Failed to parse CSV file.');
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleImport = async () => {
    setIsProcessing(true);
    let finalData = [...preview];

    if (autoGen) {
      const batchSize = 5;
      const totalBatches = Math.ceil(finalData.length / batchSize);
      
      for (let i = 0; i < finalData.length; i += batchSize) {
        const batchIndex = Math.floor(i / batchSize) + 1;
        setStatusText(`AI enhancing batch ${batchIndex}/${totalBatches}...`);
        
        const batch = finalData.slice(i, i + batchSize);
        const itemsToProcess = batch.map(b => ({ id: b.id, name: b.name }));

        const prompt = `
          I have a list of inventory items. Return a JSON object where the keys are the item IDs provided, and the values are objects with "category" (string), "description" (concise string), and "maintenance" (concise string) fields.
          Items: ${JSON.stringify(itemsToProcess)}
        `;

        try {
          const res = await callGemini(prompt, "You are a helpful inventory assistant. Output strictly valid JSON.", true);
          const aiData = JSON.parse(res);

          for (let j = 0; j < batch.length; j++) {
            const currentItem = finalData[i + j];
            const aiInfo = aiData[currentItem.id];
            
            if (aiInfo) {
              if (!currentItem.category) currentItem.category = aiInfo.category;
              if (!currentItem.description) currentItem.description = aiInfo.description;
              currentItem.maintenance = aiInfo.maintenance || ''; 
            }
          }
        } catch (e) {
          console.error(`Batch ${batchIndex} failed`, e);
          if (e?.status === 405) {
            onAIError?.({ status: e.status, message: 'OpenRouter proxy returned 405 Method Not Allowed', details: e.body || e.message });
            setError('AI service returned Method Not Allowed. Halting auto-generation.');
            break;
          } else {
            setError(`AI batch ${batchIndex} failed: ${e?.message || 'Unknown error'}`);
          }
        }
      }
    }

    setStatusText('Saving to database...');
    await onImport(finalData);
    setIsProcessing(false);
    setStatusText('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FileSpreadsheet className="text-green-600" /> Import CSV
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>

        <div className="p-6 overflow-y-auto">
          {!preview.length ? (
             <div 
               className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
               onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
               onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
               onDragOver={(e) => { e.preventDefault(); }}
               onDrop={handleDrop}
             >
               <FileUp className="mx-auto h-12 w-12 text-gray-400 mb-4" />
               <p className="text-lg font-medium text-gray-700">Drag and drop CSV file</p>
               <p className="text-sm text-gray-500 mt-2">or</p>
               <label className="mt-4 inline-block px-4 py-2 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm font-medium shadow-sm">
                 Browse Files
                 <input type="file" accept=".csv" className="hidden" onChange={(e) => processFile(e.target.files[0])} />
               </label>
               <p className="text-xs text-gray-400 mt-6">Required headers: <code>id, name</code>. Optional: <code>category, description</code></p>
             </div>
          ) : (
            <div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm text-gray-500">Found {preview.length} items</span>
                <button onClick={() => setPreview([])} className="text-sm text-red-500 hover:underline">Clear</button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-gray-600 font-medium">
                    <tr>
                      <th className="px-4 py-2">ID</th>
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2">Category</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.slice(0, 10).map((row, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 font-mono">{row.id}</td>
                        <td className="px-4 py-2">{row.name}</td>
                        <td className="px-4 py-2 text-gray-500">{row.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 10 && (
                  <div className="bg-gray-50 px-4 py-2 text-xs text-gray-500 text-center">
                    ...and {preview.length - 10} more
                  </div>
                )}
              </div>
            </div>
          )}
          {error && <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex flex-col sm:flex-row justify-between items-center gap-4">
          <label className={`flex items-center gap-2 text-sm text-gray-700 cursor-pointer ${!preview.length ? 'opacity-50 pointer-events-none' : ''}`}>
            <input 
              type="checkbox" 
              checked={autoGen} 
              onChange={(e) => setAutoGen(e.target.checked)} 
              disabled={!preview.length || isProcessing}
              className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4" 
            />
            <span className="flex items-center gap-1 font-medium">
              <Sparkles size={16} className="text-indigo-500" /> 
              Auto-generate details
            </span>
          </label>

          <div className="flex gap-3 w-full sm:w-auto">
            <button onClick={onClose} disabled={isProcessing} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium">Cancel</button>
            <button 
              disabled={!preview.length || isProcessing}
              onClick={handleImport} 
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2 min-w-[140px] justify-center"
            >
              {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
              {isProcessing ? (statusText || 'Processing...') : `Import (${preview.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// 8. Asset Action Modal (Modified for Roles)
const AssetActionModal = ({ assetId, existingAsset, userProfile, initialEditMode = false, initialDuplicateMode = false, onClose, onSave, onAIError }) => {
  const permissions = getPermissions(userProfile.role);
  
  const getNextId = (originalId) => {
    const match = originalId.match(/(\d+)$/);
    if (match) {
      const numberStr = match[1];
      const number = parseInt(numberStr, 10);
      const newNumber = (number + 1).toString().padStart(numberStr.length, '0');
      return originalId.slice(0, -numberStr.length) + newNumber;
    } 
    return `${originalId}-copy`;
  };

  const [name, setName] = useState(existingAsset?.name || '');
  const [currentId, setCurrentId] = useState(initialDuplicateMode ? getNextId(assetId) : assetId);
  const [assignee, setAssignee] = useState((!initialDuplicateMode && existingAsset?.assignedTo) || (permissions.canCheckOutForOthers ? '' : userProfile.name));
  const [category, setCategory] = useState(existingAsset?.category || '');
  const [description, setDescription] = useState(existingAsset?.description || '');
  const [maintenance, setMaintenance] = useState(existingAsset?.maintenance || '');
  const [manualUrl, setManualUrl] = useState(existingAsset?.manualUrl || '');
  const [condition, setCondition] = useState(existingAsset?.condition || 'good');
  
  const [isEditing, setIsEditing] = useState(initialEditMode || initialDuplicateMode || !existingAsset);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDuplicate, setIsDuplicate] = useState(initialDuplicateMode);
  const [error, setError] = useState('');

  // Auto-set assignee to self if not admin
  useEffect(() => {
    if (!permissions.canCheckOutForOthers && existingAsset?.status === 'available') {
      setAssignee(userProfile.name);
    }
  }, [permissions.canCheckOutForOthers, existingAsset, userProfile.name]);

  const handleAutoFill = async () => {
    if (!name.trim()) {
      setError("Please enter a name first to generate details.");
      return;
    }
    setError('');
    setIsGenerating(true);

    try {
      const prompt = `Generate a JSON object for an asset named "${name}". 
      Fields required: 
      - "category" (e.g., Laptop, Tool, Vehicle)
      - "description" (1 concise sentence technical summary)
      - "maintenance" (1 short sentence on how to care for it)
      Return only valid JSON.`;

      const resultText = await callGemini(prompt, "", true);
      const data = JSON.parse(resultText);

      if (data.category) setCategory(data.category);
      if (data.description) setDescription(data.description);
      if (data.maintenance) setMaintenance(data.maintenance);
    } catch (e) {
      console.error("Gemini Error:", e);
      if (e?.status === 405) {
        onAIError?.({ status: e.status, message: 'OpenRouter proxy returned 405 Method Not Allowed', details: e.body || e.message });
        setError('AI service unavailable (Method Not Allowed). Contact admin or check proxy.');
      } else {
        setError("Failed to generate details. Try again.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    
    if (!currentId.trim()) {
      setError('Asset ID cannot be empty');
      setIsSubmitting(false);
      return;
    }

    const data = {
      id: currentId,
      name,
      category,
      description,
      maintenance,
      manualUrl,
      condition,
      lastUpdated: serverTimestamp(),
      status: isDuplicate ? 'available' : (existingAsset ? existingAsset.status : 'available'),
      assignedTo: isDuplicate ? null : (existingAsset?.assignedTo || null)
    };

    if (!isEditing && !isDuplicate && existingAsset) {
       if (existingAsset.status === 'available') {
         data.status = 'checked-out';
         data.assignedTo = assignee; 
       } else {
         if (!permissions.canCheckOutForOthers && existingAsset.assignedTo !== userProfile.name) {
            setError("You can only check in items assigned to you.");
            setIsSubmitting(false);
            return;
         }
         data.status = 'available';
         data.assignedTo = null;
       }
    }

    try {
      await onSave(data, isDuplicate ? null : assetId);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleCondition = async () => {
    const newCondition = condition === 'good' ? 'broken' : 'good';
    setCondition(newCondition);
    if (!isEditing && existingAsset) {
        setIsSubmitting(true);
        try {
            await onSave({ ...existingAsset, condition: newCondition, lastUpdated: serverTimestamp() }, assetId);
        } catch(e) {
            console.error(e);
        } finally {
            setIsSubmitting(false);
        }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-start flex-shrink-0">
          <div>
             <h2 className="text-xl font-bold text-gray-800">
               {isDuplicate ? 'Duplicate Asset' : (existingAsset ? (isEditing ? 'Edit Asset' : existingAsset.name) : 'New Asset')}
             </h2>
             {!isEditing && !isDuplicate && (
               <div className="flex flex-col gap-1 mt-1">
                 <p className="text-sm text-gray-500 font-mono flex items-center gap-1">
                   <Barcode size={14} /> {assetId}
                 </p>
                 {existingAsset.category && <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full w-fit">{existingAsset.category}</span>}
               </div>
             )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>

        <div className="overflow-y-auto p-6">
          <form id="assetForm" onSubmit={handleSubmit} className="space-y-4">
            
            {isEditing || isDuplicate ? (
              <>
                {/* ID Field */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Asset ID</label>
                  <div className="relative">
                    <Barcode className="absolute left-3 top-3 text-gray-400" size={18} />
                    <input 
                      type="text" 
                      required
                      value={currentId}
                      onChange={(e) => setCurrentId(e.target.value)}
                      className="w-full pl-10 pr-3 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Scan or enter ID"
                    />
                  </div>
                  {isDuplicate && <p className="text-xs text-green-600 mt-1">ID automatically incremented</p>}
                </div>

                {/* Name & Auto-Fill */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Asset Name</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="flex-1 p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. Dell XPS 15"
                    />
                    <button 
                      type="button"
                      onClick={handleAutoFill}
                      disabled={isGenerating || !name.trim()}
                      className="bg-indigo-50 text-indigo-600 px-3 rounded-lg border border-indigo-100 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                      title="Auto-generate details with AI"
                    >
                      {isGenerating ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={20} />}
                    </button>
                  </div>
                  <p className="text-xs text-indigo-400 mt-1 flex items-center gap-1">
                    <Sparkles size={10} /> Enter name & click sparkle to auto-fill
                  </p>
                </div>

                {/* Manual URL */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Manual / Doc URL</label>
                    <div className="relative">
                        <FileText className="absolute left-3 top-3 text-gray-400" size={18} />
                        <input 
                        type="url" 
                        value={manualUrl}
                        onChange={(e) => setManualUrl(e.target.value)}
                        className="w-full pl-10 pr-3 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        placeholder="https://example.com/manual.pdf"
                        />
                    </div>
                </div>

                {/* Condition Toggle (Edit Mode) */}
                {permissions.canManageInventory && (
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Condition</label>
                    <select 
                        value={condition} 
                        onChange={(e) => setCondition(e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    >
                        <option value="good">✅ Good Condition</option>
                        <option value="broken">⚠️ Broken / Needs Repair</option>
                    </select>
                </div>
                )}

                {/* Extra Metadata Fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                     <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                     <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="Electronics" />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                     <label className="block text-sm font-medium text-gray-700 mb-1">Maintenance</label>
                     <input type="text" value={maintenance} onChange={(e) => setMaintenance(e.target.value)} className="w-full p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="Keep dry..." />
                  </div>
                </div>

                <div>
                   <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                   <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none" placeholder="Technical specs..."></textarea>
                </div>
              </>
            ) : (
              // View Mode
              <>
                 {/* Metadata Display */}
                {(existingAsset.description || existingAsset.maintenance || existingAsset.manualUrl) && (
                    <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-2 border border-gray-100 mb-4">
                    {existingAsset.description && <p className="text-gray-600"><strong className="text-gray-900">Specs:</strong> {existingAsset.description}</p>}
                    {existingAsset.maintenance && <p className="text-gray-600"><strong className="text-gray-900">Care:</strong> {existingAsset.maintenance}</p>}
                    {existingAsset.manualUrl && (
                        <a href={existingAsset.manualUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-600 hover:underline mt-2">
                            <FileText size={14} /> View Manual
                        </a>
                    )}
                    </div>
                )}
              </>
            )}

            {/* Check In/Out Logic */}
            {!isEditing && !isDuplicate && existingAsset && (
               <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-sm font-medium text-gray-600">Current Status:</span>
                    {existingAsset.condition === 'broken' ? (
                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 flex items-center gap-1">
                             <AlertTriangle size={12} /> BROKEN / UNAVAILABLE
                        </span>
                    ) : (
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${existingAsset.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {existingAsset.status === 'available' ? 'IN STOCK' : 'CHECKED OUT'}
                        </span>
                    )}
                  </div>

                  {existingAsset.condition === 'broken' ? (
                      <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 flex items-center gap-3">
                          <AlertTriangle size={24} />
                          <div>
                              <p className="font-bold">Item Unavailable</p>
                              <p>This item is marked as broken and cannot be checked out until fixed.</p>
                          </div>
                      </div>
                  ) : (
                     existingAsset.status === 'available' ? (
                        <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <p className="text-sm text-gray-600">Check this item out to:</p>
                            {/* Admin "Me" Shortcut */}
                            {permissions.canCheckOutForOthers && (
                                <button 
                                type="button"
                                onClick={() => setAssignee(userProfile.name)}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline flex items-center gap-1"
                                >
                                <User size={12} /> Assign to me
                                </button>
                            )}
                        </div>

                        <input 
                            type="text"
                            required 
                            placeholder="Employee Name / ID"
                            value={assignee}
                            onChange={(e) => setAssignee(e.target.value)}
                            disabled={!permissions.canCheckOutForOthers}
                            className={`w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none ${permissions.canCheckOutForOthers ? 'bg-white' : 'bg-gray-100 text-gray-500'}`}
                        />
                        {!permissions.canCheckOutForOthers && <p className="text-xs text-gray-400">Restricted to checking out to self.</p>}
                        </div>
                    ) : (
                        <div className="space-y-3">
                        <p className="text-sm text-gray-600">Currently assigned to: <strong>{existingAsset.assignedTo}</strong></p>
                        {!permissions.canCheckOutForOthers && existingAsset.assignedTo !== userProfile.name && (
                          <p className="text-xs text-red-500 font-medium">You cannot check in items assigned to others.</p>
                        )}
                        </div>
                    )
                  )}
               </div>
            )}

            {error && <div className="text-red-500 text-sm bg-red-50 p-2 rounded">{error}</div>}
          </form>
        </div>

        <div className="p-6 border-t border-gray-100 bg-white flex-shrink-0 flex gap-3">
           {isEditing || isDuplicate ? (
              <button form="assetForm" type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-sm transition-colors">
                {isSubmitting ? 'Saving...' : (isDuplicate ? 'Create Copy' : (existingAsset ? 'Save Changes' : 'Add to Inventory'))}
              </button>
           ) : (
             <>
               {/* Mark Broken/Fixed Button (View Mode) */}
               {/* Only show Mark Broken if currently good AND user is admin */}
               {condition !== 'broken' && permissions.canManageInventory && (
                   <button 
                    type="button"
                    onClick={toggleCondition}
                    disabled={isSubmitting}
                    className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                    title="Report Broken"
                   >
                       <Wrench size={18} />
                   </button>
               )}

               {/* Action Button */}
               {existingAsset.condition === 'broken' ? (
                   permissions.canManageInventory ? (
                     <button 
                      type="button"
                      onClick={toggleCondition}
                      disabled={isSubmitting}
                      className="flex-1 bg-white border-2 border-green-600 text-green-700 font-bold py-3 rounded-lg shadow-sm transition-colors flex justify-center items-center gap-2 hover:bg-green-50"
                     >
                         <CheckCircle size={18} /> Mark as Fixed
                     </button>
                   ) : (
                     <div className="flex-1 text-center text-sm text-gray-400 py-3">Maintenance Required</div>
                   )
               ) : (
                    // Disable Check In button if normal user doesn't own item
                    <button 
                      form="assetForm" 
                      type="submit" 
                      disabled={isSubmitting || (existingAsset.status !== 'available' && !permissions.canCheckOutForOthers && existingAsset.assignedTo !== userProfile.name)} 
                      className={`flex-1 font-bold py-3 rounded-lg shadow-sm transition-colors flex justify-center items-center gap-2 
                        ${isSubmitting || (existingAsset.status !== 'available' && !permissions.canCheckOutForOthers && existingAsset.assignedTo !== userProfile.name) ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : (existingAsset.status === 'available' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white')}
                      `}
                    >
                        {isSubmitting ? 'Processing...' : (existingAsset.status === 'available' ? <><ArrowRightLeft size={18} /> Check Out</> : <><CheckCircle size={18} /> Check In</>)}
                    </button>
               )}
             </>
           )}
        </div>
      </div>
    </div>
  );
};

// --- Main Application Component ---
export default function AssetTrackerApp() {
  const [userAuth, setUserAuth] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [showScanner, setShowScanner] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showCSVModal, setShowCSVModal] = useState(false);
  const [activeAssetId, setActiveAssetId] = useState(null);
  const [manualId, setManualId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState('dashboard');
  const [itemToDelete, setItemToDelete] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isDuplicateMode, setIsDuplicateMode] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [aiError, setAIError] = useState(null);

  // 1. Auth Logic - Real Firebase Auth (Restored)
  useEffect(() => {
    let unsubscribeProfile = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUserAuth(currentUser);
      
      // Clean up previous profile listener if auth state changes
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (currentUser) {
        const userDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', currentUser.uid);
        unsubscribeProfile = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            setUserProfile({ id: docSnap.id, ...docSnap.data() });
          } else {
            console.log("No profile found for user");
            setUserProfile(null);
          }
          setAuthLoading(false); // Stop loading once we have profile (or confirmation it's missing)
        }, (err) => {
          console.error("Profile fetch error", err);
          if (err.code === 'permission-denied') {
             setErrorMsg("Database access denied. Please ensure your Firestore Database is set to 'Test Mode' or has appropriate security rules.");
          }
          setAuthLoading(false);
        });
      } else {
        setUserProfile(null);
        setAuthLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  // 2. Data Listener (Wait for profile)
  useEffect(() => {
    if (!userProfile) return;
    const inventoryRef = collection(db, 'artifacts', appId, 'public', 'data', 'inventory');
    const q = query(inventoryRef);
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setInventory(items);
      },
      (error) => {
        console.error("Data fetch error:", error);
        if (error.code === 'permission-denied') {
             setErrorMsg("Database access denied. Please ensure your Firestore Database is set to 'Test Mode' or has appropriate security rules.");
        }
      }
    );
    return () => unsubscribe();
  }, [userProfile]);

  // Actions - Restored Real Auth
  const handleLogin = (email, password) => signInWithEmailAndPassword(auth, email, password);
  
  const handleSignup = async (email, password, name, employeeId) => {
    // 1. Create Auth User
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 2. Determine Role
    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'users');
    const snapshot = await getDocs(usersRef);
    const isFirstUser = snapshot.empty;
    const role = isFirstUser ? ROLES.SUPER_ADMIN : ROLES.NORMAL;

    // 3. Create Firestore Profile
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid), {
      name,
      employeeId,
      email,
      role,
      createdAt: serverTimestamp()
    }, { merge: true }).catch(error => {
      // If profile creation fails, delete user to prevent "stuck" state
      console.error("Profile creation failed, rolling back user:", error);
      deleteUser(user).catch(err => console.error("Failed to cleanup user:", err));
      throw error;
    });
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUserProfile(null);
  };

  const handleScan = (code) => {
    // 1. Check permissions immediately
    const perms = getPermissions(userProfile?.role);
    
    // 2. Check if item exists in inventory
    const itemExists = inventory.some(i => i.id === code);

    // 3. If item doesn't exist and user can't manage inventory -> BLOCK
    if (!itemExists && !perms.canManageInventory) {
        alert("Access Denied: Item not found in inventory.\nYou do not have permission to add new assets.");
        setShowScanner(false); // Close scanner if it was open
        return;
    }

    setShowScanner(false);
    setActiveAssetId(code);
    setIsEditMode(false);
    setIsDuplicateMode(false);
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'); 
    audio.play().catch(() => {}); 
  };

  const handleManualLookup = (e) => {
    e.preventDefault();
    if (manualId.trim()) {
      handleScan(manualId.trim());
      setManualId('');
    }
  };

  const importCSVData = async (data) => {
    if (!userProfile || !data.length) return;
    const batch = writeBatch(db);
    const safeData = data.slice(0, 450); 
    
    safeData.forEach(item => {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'inventory', item.id);
      batch.set(docRef, item);
    });

    await batch.commit();
  };

  const saveAsset = async (data, originalId) => {
    if (!userProfile) return;
    
    if (originalId && originalId !== data.id) {
      const newDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'inventory', data.id);
      const newDocSnap = await getDoc(newDocRef);
      if (newDocSnap.exists()) throw new Error("Asset ID already exists!");
      await setDoc(newDocRef, data);
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', originalId));
    } else {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'inventory', data.id);
      await setDoc(docRef, data, { merge: true });
    }
  };

  const toggleItemCondition = async (item) => {
    if (!userProfile) return;
    const newCondition = item.condition === 'broken' ? 'good' : 'broken';
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'inventory', item.id);
    await updateDoc(docRef, { condition: newCondition, lastUpdated: serverTimestamp() });
  };

  const initiateDelete = (item) => {
    setItemToDelete(item);
  };

  const confirmDelete = async (id) => {
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id));
      setItemToDelete(null);
    } catch(e) {
      console.error("Error deleting", e);
    }
  };

  const openEditModal = (item) => {
    setActiveAssetId(item.id);
    setIsEditMode(true);
    setIsDuplicateMode(false);
  };

  const openDuplicateModal = (item) => {
    setActiveAssetId(item.id);
    setIsDuplicateMode(true);
    setIsEditMode(true);
  };

  // Loading State
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  // Error State: Database Permission Error
  if (errorMsg) {
    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-4">
                <Shield size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Access Error</h2>
            <p className="text-gray-500 max-w-sm mb-6">{errorMsg}</p>
            <button 
                onClick={() => window.location.reload()}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg"
            >
                Retry
            </button>
        </div>
    );
  }

  // New: "Profile Missing" State Handling
  // If we have a user (from Auth) but no profile (from Database), we show this error
  // instead of the AuthScreen, preventing the "stuck" loop.
  if (userAuth && !userProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 text-center animate-in fade-in zoom-in">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 mb-4">
          <AlertTriangle size={32} />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Profile Missing</h2>
        <p className="text-gray-500 max-w-sm mb-6 text-sm">
          Your account exists, but we couldn't find your profile data. This usually happens if there was an issue during signup.
          <br/><br/>
          Please check your <strong>Firestore Rules</strong> in the Firebase Console to ensure 'anhs-inventory' path is writable.
        </p>
        <button 
          onClick={handleLogout}
          className="bg-gray-900 hover:bg-gray-800 text-white font-bold py-3 px-6 rounded-xl transition-all active:scale-95 flex items-center gap-2 mx-auto"
        >
          <LogOut size={18} /> Logout & Try Again
        </button>
      </div>
    );
  }

  // Auth State (Standard Login Screen if no userAuth)
  if (!userAuth) return (
    <AuthScreen onLogin={handleLogin} onSignup={handleSignup} />
  );

  const permissions = getPermissions(userProfile.role);

  // Filter Inventory based on role and search
  const filteredInventory = inventory.filter(item => {
    // RULE 1: STRICT VISIBILITY for Normal Users
    // Only see items currently assigned to them
    if (!permissions.canManageInventory) {
      if (item.assignedTo !== userProfile.name) {
        return false;
      }
    }

    const matchesSearch = 
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.category && item.category.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.assignedTo && item.assignedTo.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return matchesSearch;
  });

  // Calculate Stats
  const stats = {
    total: inventory.length,
    available: inventory.filter(i => i.status === 'available' && i.condition !== 'broken').length,
    checkedOut: inventory.filter(i => i.status === 'checked-out').length,
    broken: inventory.filter(i => i.condition === 'broken').length,
    myItems: inventory.filter(i => i.assignedTo === userProfile.name).length
  };

  const activeAsset = inventory.find(i => i.id === activeAssetId);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-900 pb-20 md:pb-0">
      
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-sm">
              <Package size={18} />
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight leading-none">AssetTrack</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                  {getRoleLabel(userProfile.role)}
                </span>
                <span className="text-[10px] text-gray-300">•</span>
                <span className="text-[10px] text-gray-500 font-medium truncate max-w-[100px]">{userProfile.name}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {permissions.canManageInventory && (
              <button 
                onClick={() => setShowCSVModal(true)}
                className="bg-white text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all border border-gray-200 hidden md:flex"
                title="Bulk Import"
              >
                <FileSpreadsheet size={16} />
                <span className="hidden sm:inline">Import</span>
              </button>
            )}
            
            <button 
              onClick={() => setShowAIModal(true)}
              className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all border border-indigo-100"
            >
              <Sparkles size={16} />
              <span className="hidden sm:inline">AI</span>
            </button>
            
            <button 
              onClick={() => setShowScanner(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-all active:scale-95"
            >
              <Camera size={18} />
              <span className="hidden sm:inline">Scan</span>
            </button>

            <button 
              onClick={handleLogout}
              className="text-gray-400 hover:text-red-500 p-2 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {aiError && (
        <div className="max-w-5xl mx-auto p-4">
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-md flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-yellow-800">{aiError.message || 'AI Service Error'}</p>
              {aiError.details && <pre className="text-xs text-yellow-700 mt-1 whitespace-pre-wrap">{typeof aiError.details === 'string' ? aiError.details : JSON.stringify(aiError.details)}</pre>}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={async () => { try { const res = await fetch('/api/openrouter'); const j = await res.json(); alert(JSON.stringify(j)); } catch (e) { alert('Health check failed: ' + e.message); } }} className="px-3 py-2 bg-yellow-400 text-yellow-900 rounded font-medium">Health Check</button>
              <button onClick={() => window.location.reload()} className="px-3 py-2 bg-yellow-50 border rounded">Retry (Reload)</button>
              <button onClick={() => { setAIError(null); }} className="px-3 py-2 bg-white border rounded">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto p-4 space-y-6">
        
        {/* Navigation Tabs */}
        <div className="flex p-1 bg-white rounded-xl border border-gray-200 shadow-sm max-w-md mx-auto mb-6">
          <button onClick={() => setView('dashboard')} className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${view === 'dashboard' ? 'bg-slate-100 text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Dashboard</button>
          <button onClick={() => setView('inventory')} className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${view === 'inventory' ? 'bg-slate-100 text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Inventory</button>
          {permissions.canManageUsers && (
            <button onClick={() => setView('users')} className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${view === 'users' ? 'bg-slate-100 text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Users</button>
          )}
        </div>

        {view === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Quick Actions */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold text-gray-800 mb-4">Quick Lookup</h2>
              <form onSubmit={handleManualLookup} className="flex gap-2">
                <div className="relative flex-1">
                  <Barcode className="absolute left-3 top-3 text-gray-400" size={20} />
                  <input 
                    type="text" 
                    value={manualId}
                    onChange={(e) => setManualId(e.target.value)}
                    placeholder="Enter Asset ID manually..." 
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                  />
                </div>
                <button type="submit" className="bg-slate-800 text-white px-6 py-3 rounded-xl font-semibold hover:bg-slate-900 transition-colors">Go</button>
              </form>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard title="Total" value={stats.total} icon={Package} color="bg-blue-500" />
              <StatCard title="Available" value={stats.available} icon={CheckCircle} color="bg-green-500" />
              <StatCard title="Out" value={stats.checkedOut} icon={ArrowRightLeft} color="bg-orange-500" />
              <StatCard title="Broken" value={stats.broken} icon={AlertTriangle} color="bg-red-500" />
            </div>

            {/* My Items (For everyone) */}
            {stats.myItems > 0 && (
              <div className="bg-indigo-50 rounded-2xl border border-indigo-100 p-6">
                <h3 className="font-bold text-indigo-900 mb-4 flex items-center gap-2">
                  <Shield size={20} /> Items in your possession
                </h3>
                <div className="bg-white rounded-xl shadow-sm border border-indigo-100 divide-y divide-gray-50 overflow-hidden">
                  {inventory.filter(i => i.assignedTo === userProfile.name).map(item => (
                    <div key={item.id} className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{item.name}</p>
                        <p className="text-xs text-gray-500">#{item.id}</p>
                      </div>
                      <button 
                        onClick={() => { setActiveAssetId(item.id); setIsEditMode(false); }}
                        className="text-xs bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-200"
                      >
                        Return
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'inventory' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-4 justify-between items-center">
              <h2 className="text-lg font-bold text-gray-800">Inventory</h2>
              <div className="flex gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                  <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
                  <input 
                    type="text"
                    placeholder="Search..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {permissions.canManageInventory && (
                  <button 
                    onClick={() => { setActiveAssetId(''); setIsEditMode(true); setIsDuplicateMode(false); }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 rounded-lg flex items-center justify-center"
                    title="Add Item"
                  >
                    <Plus size={20} />
                  </button>
                )}
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase font-semibold">
                  <tr>
                    <th className="px-6 py-4">Asset</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">User</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredInventory.map(item => (
                    <tr key={item.id} className="hover:bg-gray-50 group">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900 flex items-center gap-2">
                            {item.name}
                            {item.manualUrl && (
                                <a 
                                  href={item.manualUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-gray-400 hover:text-blue-600 transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                    <FileText size={16} />
                                </a>
                            )}
                        </div>
                        <div className="flex gap-2 items-center">
                           <div className="text-xs text-gray-400 font-mono">#{item.id}</div>
                           {item.category && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-bold">{item.category}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {item.condition === 'broken' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            Broken
                          </span>
                        ) : (
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${item.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${item.status === 'available' ? 'bg-green-500' : 'bg-orange-500'}`}></span>
                            {item.status === 'available' ? 'In Stock' : 'Out'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {item.assignedTo || <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          
                          {/* Toggle Condition (Admin Only) */}
                          {permissions.canManageInventory && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); toggleItemCondition(item); }}
                              className={`p-2 rounded-lg transition-colors ${item.condition === 'broken' ? 'text-red-600 bg-red-50 hover:bg-red-100' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                              title={item.condition === 'broken' ? "Mark as Fixed" : "Mark as Broken"}
                            >
                              <Wrench size={16} />
                            </button>
                          )}

                          {/* Manage Button */}
                          <button 
                            onClick={() => { setActiveAssetId(item.id); setIsEditMode(false); setIsDuplicateMode(false); }}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                            title="Check In/Out"
                          >
                            <ArrowRightLeft size={16} />
                          </button>
                          
                          {permissions.canManageInventory && (
                            <>
                              <button 
                                onClick={() => openEditModal(item)}
                                className="p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 rounded-lg"
                                title="Edit"
                              >
                                <Pencil size={16} />
                              </button>
                              <button 
                                onClick={() => openDuplicateModal(item)}
                                className="p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 rounded-lg"
                                title="Duplicate"
                              >
                                <Copy size={16} />
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); initiateDelete(item); }}
                                className="p-2 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg"
                                title="Delete"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredInventory.length === 0 && (
                    <tr><td colSpan="4" className="px-6 py-12 text-center text-gray-400">
                      {permissions.canManageInventory ? "No assets found." : "No checked out items found."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === 'users' && permissions.canManageUsers && (
          <UserManagement currentUser={userProfile} />
        )}

      </main>

      {/* Floating Scan Button (Mobile) */}
      <div className="md:hidden fixed bottom-6 right-6 flex flex-col gap-3">
        {permissions.canManageInventory && (
          <button 
            onClick={() => setShowCSVModal(true)}
            className="w-12 h-12 bg-white text-gray-600 rounded-full shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform z-40 border border-gray-200"
          >
            <FileSpreadsheet size={20} />
          </button>
        )}
        <button 
          onClick={() => setShowScanner(true)}
          className="w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform z-40"
        >
          <Camera size={24} />
        </button>
      </div>

      {/* Modals */}
      {showScanner && <BarcodeScanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
      
      {showAIModal && <AskAIModal inventory={inventory} onClose={() => setShowAIModal(false)} onAIError={setAIError} />}

      {showCSVModal && permissions.canManageInventory && <CSVImportModal onClose={() => setShowCSVModal(false)} onImport={importCSVData} onAIError={setAIError} />}

      {activeAssetId !== null && (
        <AssetActionModal 
          assetId={activeAssetId || manualId || `NEW-${Date.now()}`}
          existingAsset={activeAsset}
          userProfile={userProfile}
          initialEditMode={isEditMode}
          initialDuplicateMode={isDuplicateMode}
          onClose={() => { setActiveAssetId(null); setIsDuplicateMode(false); }}
          onSave={saveAsset}
          onAIError={setAIError}
        />
      )}

      {itemToDelete && (
        <DeleteConfirmModal 
          item={itemToDelete}
          onCancel={() => setItemToDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
      
      {/* Footer Connection Status */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-sm border-t border-gray-100 p-2 text-center text-[10px] text-gray-400 z-10 hidden md:block">
         <div className="flex justify-center items-center gap-2">
           <Wifi size={12} className="text-green-500" />
           <span className="font-mono">DB: anhs-inventory • {userProfile ? userProfile.email : 'Not Logged In'}</span>
         </div>
      </footer>

    </div>
  );
}