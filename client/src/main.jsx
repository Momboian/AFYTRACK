import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider, Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login, { ForgotPassword, ResetPassword } from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Planner, { TaskDetail } from './pages/Planner.jsx';
import Activities from './pages/Activities.jsx';
import Registers, { RegisterProfile } from './pages/Registers.jsx';
import Inspections, { InspectionForm, InspectionDetail } from './pages/Inspections.jsx';
import FollowUps from './pages/FollowUps.jsx';
import Notices, { NoticeDetail } from './pages/Notices.jsx';
import Reports from './pages/Reports.jsx';
import Team from './pages/Team.jsx';
import SettingsPage from './pages/Settings.jsx';

function Protected({ children }) {
  const { loading, me } = useAuth();
  if (loading) return <Spinner label="Opening AfyaTrack…" />;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}
function PublicOnly({ children }) {
  const { loading, me } = useAuth();
  if (loading) return <Spinner />;
  if (me) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="planner" element={<Planner />} />
        <Route path="planner/:id" element={<TaskDetail />} />
        <Route path="activities" element={<Activities />} />
        <Route path="registers/:type" element={<Registers />} />
        <Route path="registers/:type/:id" element={<RegisterProfile />} />
        <Route path="inspections" element={<Inspections />} />
        <Route path="inspections/new" element={<InspectionForm />} />
        <Route path="inspections/:id" element={<InspectionDetail />} />
        <Route path="follow-ups" element={<FollowUps />} />
        <Route path="notices" element={<Notices />} />
        <Route path="notices/:id" element={<NoticeDetail />} />
        <Route path="reports" element={<Reports />} />
        <Route path="team" element={<Team />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider><App /></ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
