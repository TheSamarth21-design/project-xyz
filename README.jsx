
import React, { useState, useEffect, useRef } from 'react';
import {
    Heart, Activity, Battery, AlertTriangle, PhoneCall,
    User, Users, Clock, ShieldAlert, CheckCircle,
    XOctagon, Power, Smartphone, BellRing, Settings,
    LogOut, Plus, Trash2, AlertCircle
} from 'lucide-react';

// --- FIREBASE SETUP ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import {
    getFirestore, collection, doc, setDoc, getDoc,
    onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp
} from 'firebase/firestore';

// Environment variables provided by the platform
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'elderly-care-app-default';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- UTILS ---
const generateDeviceId = () => 'ESP32-' + Math.random().toString(36).substr(2, 6).toUpperCase();
const formatDate = (timestamp) => {
    if (!timestamp) return 'Just now';
    const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
const formatDateFull = (timestamp) => {
    if (!timestamp) return 'Unknown time';
    const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
};

export default function App() {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [device, setDevice] = useState(null);
    const [events, setEvents] = useState([]);
    const [caregivers, setCaregivers] = useState([]);

    const [isLoading, setIsLoading] = useState(true);
    const [currentTab, setCurrentTab] = useState('dashboard');
    const [errorMsg, setErrorMsg] = useState('');

    // --- 1. FIREBASE AUTH & INIT ---
    useEffect(() => {
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (err) {
                console.error("Auth Error:", err);
                setErrorMsg("Failed to authenticate.");
            }
        };
        initAuth();

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (!currentUser) {
                setProfile(null);
                setDevice(null);
                setIsLoading(false);
            }
        });
        return () => unsubscribe();
    }, []);

    // --- 2. DATA SUBSCRIPTIONS ---
    useEffect(() => {
        if (!user) return;

        // Fetch User Profile
        const profileRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
        const unsubProfile = onSnapshot(profileRef, (docSnap) => {
            if (docSnap.exists()) {
                const pData = docSnap.data();
                setProfile(pData);
                setIsLoading(false);
            } else {
                setProfile(null);
                setIsLoading(false);
            }
        }, (err) => console.error("Profile sync error:", err));

        return () => unsubProfile();
    }, [user]);

    // Subscribe to Device, Events, and Caregivers once Profile is loaded
    useEffect(() => {
        if (!user || !profile || !profile.deviceId) {
            setDevice(null);
            return;
        }

        const deviceId = profile.deviceId;

        // Subscribe to Device Real-time Data
        const deviceRef = doc(db, 'artifacts', appId, 'public', 'data', 'devices', deviceId);
        const unsubDevice = onSnapshot(deviceRef, (docSnap) => {
            if (docSnap.exists()) {
                setDevice({ id: docSnap.id, ...docSnap.data() });
            } else {
                // If device doc doesn't exist yet, we'll wait or it will be created during pairing
            }
        }, (err) => console.error("Device sync error:", err));

        // Subscribe to Events (Filter in memory per Rule 2 constraints)
        const eventsRef = collection(db, 'artifacts', appId, 'public', 'data', 'events');
        const unsubEvents = onSnapshot(eventsRef, (snapshot) => {
            const allEvents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            // Filter memory: Only show events for this paired device
            const myEvents = allEvents
                .filter(e => e.deviceId === deviceId)
                .sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));
            setEvents(myEvents);
        }, (err) => console.error("Events sync error:", err));

        // Subscribe to Caregivers (Filter in memory)
        const caregiversRef = collection(db, 'artifacts', appId, 'public', 'data', 'caregivers');
        const unsubCaregivers = onSnapshot(caregiversRef, (snapshot) => {
            const allCaregivers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            const myCaregivers = allCaregivers
                .filter(c => c.deviceId === deviceId)
                .sort((a, b) => a.priority - b.priority);
            setCaregivers(myCaregivers);
        }, (err) => console.error("Caregivers sync error:", err));

        return () => {
            unsubDevice();
            unsubEvents();
            unsubCaregivers();
        };
    }, [user, profile]);

    // --- 3. ACTIONS ---
    const handleRegisterProfile = async (name, role) => {
        setIsLoading(true);
        try {
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid), {
                uid: user.uid,
                name,
                role,
                createdAt: serverTimestamp(),
                deviceId: null // To be paired next
            });
        } catch (err) {
            setErrorMsg("Error creating profile");
        }
        setIsLoading(false);
    };

    const handlePairDevice = async (deviceId) => {
        setIsLoading(true);
        try {
            // 1. Ensure Device document exists
            const deviceRef = doc(db, 'artifacts', appId, 'public', 'data', 'devices', deviceId);
            const devSnap = await getDoc(deviceRef);

            if (!devSnap.exists()) {
                // Initialize new device
                await setDoc(deviceRef, {
                    status: 'SAFE',
                    vitals: { heartRate: 75, spo2: 98, battery: 100 },
                    lastUpdate: serverTimestamp(),
                    pairedElderly: profile.role === 'elderly' ? user.uid : null
                });
            } else if (profile.role === 'elderly') {
                // Update existing device with this elderly user
                await updateDoc(deviceRef, { pairedElderly: user.uid });
            }

            // 2. Update User Profile with the deviceId
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid), {
                deviceId: deviceId
            });

        } catch (err) {
            setErrorMsg("Failed to pair device");
        }
        setIsLoading(false);
    };

    const handleLogout = async () => {
        // Soft logout for demo (clears profile to restart flow)
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid));
        setProfile(null);
    };

    // --- RENDER HELPERS ---
    if (isLoading) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white"><Activity className="animate-spin w-12 h-12 text-blue-500" /></div>;
    }

    return (
        <div className="min-h-screen bg-slate-900 font-sans text-slate-800 flex flex-col md:flex-row items-center justify-center p-4 gap-8">

            {/* --- LEFT: MOBILE APP UI --- */}
            <div className="w-full max-w-[400px] h-[800px] max-h-[90vh] bg-white rounded-[3rem] shadow-2xl overflow-hidden relative border-[12px] border-slate-800 flex flex-col shrink-0">

                {/* Phone Status Bar */}
                <div className="h-8 bg-slate-100 flex items-center justify-between px-6 text-xs font-semibold text-slate-500 rounded-t-3xl z-10 shrink-0">
                    <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <div className="w-24 h-6 bg-slate-800 rounded-b-xl absolute top-0 left-1/2 -translate-x-1/2"></div> {/* Notch */}
                    <div className="flex items-center gap-1">
                        <BellRing size={12} />
                        <Battery size={14} className="ml-1 text-slate-700" />
                    </div>
                </div>

                {/* App Content Area */}
                <div className="flex-1 overflow-y-auto bg-slate-50 relative flex flex-col">
                    {!profile ? (
                        <OnboardingScreen onRegister={handleRegisterProfile} />
                    ) : !profile.deviceId ? (
                        <PairingScreen onPair={handlePairDevice} role={profile.role} />
                    ) : (
                        <>
                            {/* Dynamic Screens based on Tab */}
                            <div className="flex-1 pb-20">
                                {currentTab === 'dashboard' && <DashboardScreen profile={profile} device={device} events={events} caregivers={caregivers} user={user} />}
                                {currentTab === 'caregivers' && <CaregiversScreen deviceId={profile.deviceId} caregivers={caregivers} role={profile.role} />}
                                {currentTab === 'history' && <HistoryScreen events={events} />}
                            </div>

                            {/* Bottom Navigation */}
                            <div className="absolute bottom-0 w-full h-16 bg-white border-t border-slate-200 flex justify-around items-center px-4 rounded-b-2xl pb-2">
                                <NavButton icon={<Activity />} label="Vitals" active={currentTab === 'dashboard'} onClick={() => setCurrentTab('dashboard')} />
                                <NavButton icon={<Users />} label="Care" active={currentTab === 'caregivers'} onClick={() => setCurrentTab('caregivers')} />
                                <NavButton icon={<Clock />} label="Logs" active={currentTab === 'history'} onClick={() => setCurrentTab('history')} />
                            </div>
                        </>
                    )}

                    {/* Global Alert Overlay (Triggers on FALL or SOS) */}
                    {device && (device.status === 'FALL' || device.status === 'SOS' || device.status === 'AMBULANCE') && (
                        <AlertOverlay device={device} profile={profile} />
                    )}
                </div>
            </div>

            {/* --- RIGHT: ESP32 HARDWARE SIMULATOR --- */}
            {profile && profile.deviceId && (
                <ESP32Simulator deviceId={profile.deviceId} currentDeviceState={device} />
            )}

        </div>
    );
}

// ==========================================
// SCREEN COMPONENTS
// ==========================================

function OnboardingScreen({ onRegister }) {
    const [name, setName] = useState('');
    const [role, setRole] = useState('elderly');

    return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-white">
            <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <ShieldAlert size={40} />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">"My Emergency App"</h1>
            <p className="text-slate-500 mb-10">Fall Detection & Emergency Response</p>

            <div className="w-full space-y-4">
                <input
                    type="text"
                    placeholder="Enter your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-100 border-transparent focus:border-blue-500 focus:bg-white focus:ring-0 rounded-xl px-4 py-3 outline-none transition-all"
                />

                <div className="grid grid-cols-2 gap-3 mt-4">
                    <button
                        onClick={() => setRole('elderly')}
                        className={`py-4 flex flex-col items-center justify-center rounded-xl border-2 transition-all ${role === 'elderly' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                    >
                        <User size={24} className="mb-2" />
                        <span className="font-semibold text-sm">I am the Wearer</span>
                    </button>
                    <button
                        onClick={() => setRole('caregiver')}
                        className={`py-4 flex flex-col items-center justify-center rounded-xl border-2 transition-all ${role === 'caregiver' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                    >
                        <Users size={24} className="mb-2" />
                        <span className="font-semibold text-sm">I am a Caregiver</span>
                    </button>
                </div>

                <button
                    onClick={() => name.trim() && onRegister(name, role)}
                    disabled={!name.trim()}
                    className="w-full mt-8 bg-slate-900 text-white font-bold py-4 rounded-xl disabled:bg-slate-300 transition-colors shadow-lg"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}

function PairingScreen({ onPair, role }) {
    const [deviceId, setDeviceId] = useState('');

    const generateNew = () => {
        setDeviceId(generateDeviceId());
    };

    return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-white">
            <Smartphone size={48} className="text-slate-400 mb-6" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Pair Device</h2>
            <p className="text-slate-500 mb-8 text-sm">
                {role === 'elderly'
                    ? "Enter your ESP32 Wearable ID to connect it to your account."
                    : "Enter the Wearable ID of the person you want to monitor."}
            </p>

            <div className="w-full space-y-4">
                <input
                    type="text"
                    placeholder="e.g. ESP32-A1B2C3"
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value.toUpperCase())}
                    className="w-full text-center tracking-widest font-mono font-bold text-lg bg-slate-100 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-4 outline-none uppercase"
                />

                {role === 'elderly' && (
                    <button onClick={generateNew} className="text-sm text-blue-600 font-semibold hover:underline">
                        Generate Mock Device ID
                    </button>
                )}

                <button
                    onClick={() => deviceId.trim() && onPair(deviceId)}
                    disabled={deviceId.length < 5}
                    className="w-full mt-8 bg-blue-600 text-white font-bold py-4 rounded-xl disabled:bg-slate-300 transition-colors shadow-lg shadow-blue-200"
                >
                    Connect Device
                </button>
            </div>
        </div>
    );
}

function DashboardScreen({ profile, device, events, caregivers }) {
    if (!device) return <div className="p-8 text-center text-slate-500 mt-20">Waiting for device data...</div>;

    const { vitals, status, lastUpdate } = device;
    const isSafe = status === 'SAFE';

    return (
        <div className="p-6 pb-24 h-full flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Hello, {profile.name.split(' ')[0]}</h2>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{profile.role}</p>
                </div>
                <div className={`px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm ${isSafe ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700 animate-pulse'}`}>
                    <div className={`w-2 h-2 rounded-full ${isSafe ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                    {status}
                </div>
            </div>

            {/* Vitals Grid */}
            <div className="grid grid-cols-2 gap-4 mb-6">
                <VitalCard
                    icon={<Heart size={24} className="text-rose-500" />}
                    label="Heart Rate"
                    value={`${vitals?.heartRate || '--'}`}
                    unit="bpm"
                    color="bg-rose-50"
                />
                <VitalCard
                    icon={<Activity size={24} className="text-blue-500" />}
                    label="SpO2"
                    value={`${vitals?.spo2 || '--'}`}
                    unit="%"
                    color="bg-blue-50"
                />
                <VitalCard
                    icon={<Battery size={24} className="text-emerald-500" />}
                    label="Battery"
                    value={`${vitals?.battery || '--'}`}
                    unit="%"
                    color="bg-emerald-50"
                />
                <div className="bg-slate-100 rounded-2xl p-4 flex flex-col justify-center items-center text-center shadow-sm">
                    <Clock size={24} className="text-slate-400 mb-2" />
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Last Sync</p>
                    <p className="text-sm font-bold text-slate-700">{formatDate(lastUpdate)}</p>
                </div>
            </div>

            {/* SOS Button (Elderly Only) */}
            {profile.role === 'elderly' && (
                <div className="mt-auto mb-4 flex justify-center relative">
                    <div className="absolute inset-0 bg-red-500 rounded-full blur-2xl opacity-20 animate-pulse"></div>
                    <button
                        onClick={async () => {
                            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'devices', profile.deviceId), {
                                status: 'SOS',
                                lastUpdate: serverTimestamp()
                            });
                            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'events'), {
                                deviceId: profile.deviceId,
                                type: 'MANUAL_SOS',
                                timestamp: serverTimestamp(),
                                status: 'ACTIVE'
                            });
                        }}
                        className="relative w-48 h-48 bg-gradient-to-b from-red-500 to-red-600 rounded-full shadow-[0_10px_30px_rgba(239,68,68,0.5)] border-8 border-red-100 flex flex-col items-center justify-center text-white active:scale-95 transition-transform"
                    >
                        <ShieldAlert size={48} className="mb-2" />
                        <span className="text-2xl font-black tracking-wider">SOS</span>
                        <span className="text-xs font-semibold opacity-80 mt-1">PRESS & HOLD</span>
                    </button>
                </div>
            )}

            {/* Quick Caregiver Info */}
            {caregivers.length > 0 && profile.role === 'elderly' && (
                <div className="mt-4 bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-slate-700">Primary Caregiver</h3>
                        <PhoneCall size={14} className="text-blue-500" />
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-bold">
                            {caregivers[0].name.charAt(0)}
                        </div>
                        <div>
                            <p className="font-bold text-slate-800 text-sm">{caregivers[0].name}</p>
                            <p className="text-xs text-slate-500">{caregivers[0].phone}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function VitalCard({ icon, label, value, unit, color }) {
    return (
        <div className={`${color} rounded-2xl p-4 flex flex-col items-start shadow-sm`}>
            <div className="mb-4 bg-white p-2 rounded-xl shadow-sm">{icon}</div>
            <p className="text-2xl font-black text-slate-800 flex items-baseline gap-1">
                {value} <span className="text-xs font-bold text-slate-500">{unit}</span>
            </p>
            <p className="text-xs font-bold text-slate-500 mt-1">{label}</p>
        </div>
    );
}

function CaregiversScreen({ deviceId, caregivers, role }) {
    const [isAdding, setIsAdding] = useState(false);
    const [newCG, setNewCG] = useState({ name: '', phone: '' });

    const handleAdd = async () => {
        if (!newCG.name || !newCG.phone) return;
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'caregivers'), {
            deviceId,
            name: newCG.name,
            phone: newCG.phone,
            priority: caregivers.length + 1
        });
        setIsAdding(false);
        setNewCG({ name: '', phone: '' });
    };

    const handleRemove = async (id) => {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'caregivers', id));
    };

    return (
        <div className="p-6 h-full flex flex-col bg-slate-50">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-slate-800">Care Team</h2>
                {role === 'elderly' && (
                    <button onClick={() => setIsAdding(!isAdding)} className="bg-slate-900 text-white p-2 rounded-full">
                        <Plus size={20} />
                    </button>
                )}
            </div>

            {isAdding && (
                <div className="bg-white p-4 rounded-2xl shadow-sm mb-4 border border-blue-100">
                    <input
                        type="text" placeholder="Name" value={newCG.name} onChange={e => setNewCG({ ...newCG, name: e.target.value })}
                        className="w-full bg-slate-50 rounded-lg px-3 py-2 mb-2 text-sm outline-none border border-slate-200"
                    />
                    <input
                        type="tel" placeholder="Phone Number" value={newCG.phone} onChange={e => setNewCG({ ...newCG, phone: e.target.value })}
                        className="w-full bg-slate-50 rounded-lg px-3 py-2 mb-3 text-sm outline-none border border-slate-200"
                    />
                    <button onClick={handleAdd} className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-bold">Save Caregiver</button>
                </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3">
                {caregivers.length === 0 ? (
                    <div className="text-center text-slate-400 mt-10">
                        <Users size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No caregivers added yet.</p>
                    </div>
                ) : (
                    caregivers.map((cg, idx) => (
                        <div key={cg.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-100 text-blue-700 font-bold rounded-full flex items-center justify-center">
                                    #{idx + 1}
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800">{cg.name}</p>
                                    <p className="text-xs text-slate-500 font-mono mt-0.5">{cg.phone}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <a href={`tel:${cg.phone}`} className="p-2 bg-green-50 text-green-600 rounded-full hover:bg-green-100 transition-colors">
                                    <PhoneCall size={18} />
                                </a>
                                {role === 'elderly' && (
                                    <button onClick={() => handleRemove(cg.id)} className="p-2 bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

function HistoryScreen({ events }) {
    return (
        <div className="p-6 h-full flex flex-col bg-slate-50">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">Activity Log</h2>

            <div className="flex-1 overflow-y-auto pr-2 space-y-4 relative">
                <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-slate-200 z-0"></div>
                {events.length === 0 ? (
                    <div className="text-center text-slate-400 mt-10 z-10 relative bg-slate-50 py-4">
                        <Clock size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No events recorded.</p>
                    </div>
                ) : (
                    events.map(event => {
                        const isEmergency = event.type.includes('FALL') || event.type.includes('SOS') || event.type.includes('AMBULANCE');
                        const isResolved = event.type === 'FALSE_ALARM' || event.status === 'RESOLVED';

                        return (
                            <div key={event.id} className="relative z-10 pl-10">
                                <div className={`absolute left-2.5 top-1 w-3.5 h-3.5 rounded-full border-2 border-slate-50 ${isEmergency && !isResolved ? 'bg-red-500' : isResolved ? 'bg-slate-400' : 'bg-blue-500'}`}></div>
                                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                                    <div className="flex justify-between items-start mb-1">
                                        <h4 className={`font-bold text-sm ${isEmergency ? 'text-red-600' : 'text-slate-800'}`}>
                                            {event.type.replace('_', ' ')}
                                        </h4>
                                        <span className="text-[10px] text-slate-400 font-bold">{formatDateFull(event.timestamp)}</span>
                                    </div>
                                    <p className="text-xs text-slate-500">
                                        {event.status ? `Status: ${event.status}` : 'Logged to system'}
                                    </p>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

function NavButton({ icon, label, active, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`flex flex-col items-center justify-center w-16 h-12 transition-colors ${active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
            <div className={`mb-1 transition-transform ${active ? 'scale-110' : ''}`}>
                {icon}
            </div>
            <span className="text-[10px] font-bold">{label}</span>
        </button>
    );
}

// ==========================================
// ALERT OVERLAY (THE CORE ENGINE)
// ==========================================
function AlertOverlay({ device, profile }) {
    const [countdown, setCountdown] = useState(15);
    const isFall = device.status === 'FALL';
    const isSOS = device.status === 'SOS';
    const isAmbulance = device.status === 'AMBULANCE';

    useEffect(() => {
        let timer;
        if (isFall && countdown > 0) {
            timer = setInterval(() => {
                setCountdown(prev => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        escalateToSOS();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [isFall, countdown]);

    const escalateToSOS = async () => {
        // Escalate Fall to SOS
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'devices', profile.deviceId), {
            status: 'SOS',
            lastUpdate: serverTimestamp()
        });
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'events'), {
            deviceId: profile.deviceId,
            type: 'FALL_ESCALATED',
            timestamp: serverTimestamp(),
            status: 'ACTIVE'
        });
    };

    const handleCancelFall = async () => {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'devices', profile.deviceId), {
            status: 'SAFE',
            lastUpdate: serverTimestamp()
        });
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'events'), {
            deviceId: profile.deviceId,
            type: 'FALSE_ALARM',
            timestamp: serverTimestamp(),
            status: 'RESOLVED'
        });
    };

    const handleRequestAmbulance = async () => {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'devices', profile.deviceId), {
            status: 'AMBULANCE',
            lastUpdate: serverTimestamp()
        });
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'events'), {
            deviceId: profile.deviceId,
            type: 'AMBULANCE_REQUESTED',
            timestamp: serverTimestamp(),
            status: 'DISPATCHED',
            requestedBy: profile.role
        });
    };

    const handleResolveEmergency = async () => {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'devices', profile.deviceId), {
            status: 'SAFE',
            lastUpdate: serverTimestamp()
        });
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'events'), {
            deviceId: profile.deviceId,
            type: 'EMERGENCY_RESOLVED',
            timestamp: serverTimestamp(),
            resolvedBy: profile.role
        });
    };

    // Determine colors based on status
    const bgColor = isAmbulance ? 'bg-blue-600' : isSOS ? 'bg-red-600' : 'bg-orange-500';

    return (
        <div className={`absolute inset-0 z-50 flex flex-col p-6 ${bgColor} text-white transition-colors duration-500`}>
            <div className="flex-1 flex flex-col items-center justify-center text-center">

                {/* Pulsing Warning Icon */}
                <div className="relative mb-8">
                    <div className="absolute inset-0 bg-white opacity-20 rounded-full animate-ping"></div>
                    <AlertTriangle size={80} className="relative z-10" />
                </div>

                {/* Dynamic Titles */}
                {isFall && (
                    <>
                        <h1 className="text-4xl font-black mb-2 uppercase">Fall Detected!</h1>
                        {profile.role === 'elderly' ? (
                            <p className="text-xl mb-8 opacity-90">Are you okay? Automatically sending SOS in...</p>
                        ) : (
                            <p className="text-xl mb-8 opacity-90">Waiting for user response...</p>
                        )}

                        <div className="text-8xl font-black font-mono tracking-tighter mb-12">
                            {countdown}
                        </div>
                    </>
                )}

                {isSOS && (
                    <>
                        <h1 className="text-4xl font-black mb-2 uppercase tracking-wide">Emergency SOS</h1>
                        <p className="text-lg mb-8 opacity-90 font-bold">
                            {profile.role === 'elderly' ? 'Caregivers have been notified!' : 'Immediate Action Required!'}
                        </p>
                    </>
                )}

                {isAmbulance && (
                    <>
                        <h1 className="text-3xl font-black mb-2 uppercase tracking-wide">Ambulance Requested</h1>
                        <p className="text-lg mb-8 opacity-90 font-bold">Help is on the way.</p>
                    </>
                )}

                {/* Live Vitals Snapshot during emergency */}
                <div className="w-full bg-black/20 rounded-2xl p-4 flex justify-around mb-8 border border-white/10 backdrop-blur-sm">
                    <div className="text-center">
                        <Heart size={20} className="mx-auto mb-1 opacity-80" />
                        <div className="text-2xl font-bold">{device.vitals?.heartRate}</div>
                    </div>
                    <div className="text-center">
                        <Activity size={20} className="mx-auto mb-1 opacity-80" />
                        <div className="text-2xl font-bold">{device.vitals?.spo2}%</div>
                    </div>
                </div>

            </div>

            {/* Action Buttons */}
            <div className="space-y-4 pb-6">
                {isFall && profile.role === 'elderly' && (
                    <button
                        onClick={handleCancelFall}
                        className="w-full py-5 bg-white text-orange-600 rounded-2xl font-black text-xl shadow-xl active:scale-95 transition-transform uppercase tracking-wider"
                    >
                        I'm Okay (Cancel)
                    </button>
                )}

                {(isFall || isSOS) && profile.role === 'caregiver' && (
                    <button
                        onClick={handleRequestAmbulance}
                        className="w-full py-5 bg-black text-white rounded-2xl font-black text-xl shadow-xl active:scale-95 transition-transform uppercase tracking-wider flex items-center justify-center gap-2"
                    >
                        <PhoneCall size={24} /> Call Ambulance
                    </button>
                )}

                {(isSOS || isAmbulance) && (
                    <button
                        onClick={handleResolveEmergency}
                        className="w-full py-4 bg-white/20 hover:bg-white/30 text-white rounded-2xl font-bold text-lg active:scale-95 transition-transform border border-white/30"
                    >
                        Mark as Resolved
                    </button>
                )}
            </div>
        </div>
    );
}


// ==========================================
// ESP32 HARDWARE SIMULATOR PANEL
// ==========================================
function ESP32Simulator({ deviceId, currentDeviceState }) {
    const [vitals, setVitals] = useState({ heartRate: 75, spo2: 98, battery: 82 });
    const [autoUpdate, setAutoUpdate] = useState(false);

    // Simulate normal vital fluctuations
    useEffect(() => {
        let interval;
        if (autoUpdate) {
            interval = setInterval(() => {
                setVitals(prev => {
                    const newHR = Math.max(60, Math.min(120, prev.heartRate + (Math.floor(Math.random() * 5) - 2)));
                    const newSpO2 = Math.max(90, Math.min(100, prev.spo2 + (Math.floor(Math.random() * 3) - 1)));
                    return { ...prev, heartRate: newHR, spo2: newSpO2 };
                });
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [autoUpdate]);

    // Sync simulated vitals to Firestore when they change (throttled in a real app, direct here for demo)
    useEffect(() => {
        if (autoUpdate) {
            syncToFirebase('SAFE');
        }
        // eslint-disable-next-line
    }, [vitals]);

    const syncToFirebase = async (forcedStatus) => {
        try {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'devices', deviceId), {
                vitals: vitals,
                status: forcedStatus || currentDeviceState?.status || 'SAFE',
                lastUpdate: serverTimestamp()
            });
        } catch (e) { console.error("Simulator sync error", e); }
    };

    const triggerFall = async () => {
        setAutoUpdate(false);
        // Spike HR during a fall
        const fallVitals = { ...vitals, heartRate: 110 };
        setVitals(fallVitals);
        try {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'devices', deviceId), {
                vitals: fallVitals,
                status: 'FALL',
                lastUpdate: serverTimestamp()
            });
        } catch (e) { }
    };

    const triggerSOS = async () => {
        setAutoUpdate(false);
        try {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'devices', deviceId), {
                status: 'SOS',
                lastUpdate: serverTimestamp()
            });
        } catch (e) { }
    };

    const resetDevice = async () => {
        setAutoUpdate(true);
        setVitals({ heartRate: 72, spo2: 99, battery: vitals.battery });
        try {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'devices', deviceId), {
                status: 'SAFE',
                lastUpdate: serverTimestamp()
            });
        } catch (e) { }
    };

    return (
        <div className="w-[320px] bg-slate-800 rounded-3xl p-6 text-slate-300 shadow-2xl border border-slate-700 hidden md:flex flex-col">
            <div className="flex items-center gap-3 mb-6 border-b border-slate-700 pb-4">
                <div className="p-2 bg-slate-700 rounded-lg"><Activity className="text-emerald-400" /></div>
                <div>
                    <h3 className="font-bold text-white leading-tight">ESP32 Wearable</h3>
                    <p className="text-xs font-mono text-slate-400">{deviceId}</p>
                </div>
            </div>

            <div className="space-y-4 mb-8">
                <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Heart Rate (bpm)</label>
                    <input type="range" min="40" max="180" value={vitals.heartRate} onChange={e => setVitals({ ...vitals, heartRate: parseInt(e.target.value) })} className="w-full accent-rose-500" />
                    <div className="text-right text-rose-400 font-mono text-sm">{vitals.heartRate} bpm</div>
                </div>
                <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">SpO2 (%)</label>
                    <input type="range" min="80" max="100" value={vitals.spo2} onChange={e => setVitals({ ...vitals, spo2: parseInt(e.target.value) })} className="w-full accent-blue-500" />
                    <div className="text-right text-blue-400 font-mono text-sm">{vitals.spo2} %</div>
                </div>
            </div>

            <div className="flex items-center justify-between mb-8 bg-slate-900 p-3 rounded-xl border border-slate-700">
                <span className="text-sm font-semibold">Auto-fluctuate Vitals</span>
                <button
                    onClick={() => setAutoUpdate(!autoUpdate)}
                    className={`w-12 h-6 rounded-full relative transition-colors ${autoUpdate ? 'bg-emerald-500' : 'bg-slate-600'}`}
                >
                    <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${autoUpdate ? 'left-7' : 'left-1'}`}></div>
                </button>
            </div>

            <div className="space-y-3 mt-auto">
                <p className="text-xs text-center text-slate-500 font-semibold mb-2 uppercase">Hardware Triggers</p>
                <button onClick={triggerFall} className="w-full py-3 bg-orange-500/10 text-orange-400 border border-orange-500/30 rounded-xl font-bold hover:bg-orange-500/20 transition-colors flex justify-center items-center gap-2">
                    <AlertCircle size={18} /> Simulate MPU6050 Fall
                </button>
                <button onClick={triggerSOS} className="w-full py-3 bg-red-500/10 text-red-400 border border-red-500/30 rounded-xl font-bold hover:bg-red-500/20 transition-colors flex justify-center items-center gap-2">
                    <ShieldAlert size={18} /> Press Hardware SOS
                </button>
                <button onClick={resetDevice} className="w-full py-3 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-600 transition-colors mt-4">
                    Reset to SAFE
                </button>
            </div>
        </div>
    );
}
