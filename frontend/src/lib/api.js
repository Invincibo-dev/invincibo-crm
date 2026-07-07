import axios from "axios";
import { getToken } from "./auth";

const getDefaultApiBaseUrl = () => {
  if (typeof window !== "undefined" && window.location.hostname === "cv-pam.com") {
    return "https://api.cv-pam.com/api";
  }
  return "/api";
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || getDefaultApiBaseUrl()
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
