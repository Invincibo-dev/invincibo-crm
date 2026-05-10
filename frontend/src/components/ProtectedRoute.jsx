import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { isAuthenticated } from "../lib/auth";

const ProtectedRoute = () => {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
};

export default ProtectedRoute;
