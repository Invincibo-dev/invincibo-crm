import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import Users from "./pages/Users";
import Support from "./pages/Support";
import Contacts from "./pages/Contacts";
import FollowUps from "./pages/FollowUps";
import Groups from "./pages/Groups";
import Activation from "./pages/Activation";

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/users" element={<Users />} />
        <Route path="/support" element={<Support />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/followups" element={<FollowUps />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/activation" element={<Activation />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
};

export default App;
