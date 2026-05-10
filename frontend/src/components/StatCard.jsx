import React from "react";

const StatCard = ({ title, value, color = "text-slate-800" }) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className={`mt-2 text-2xl font-bold tracking-tight sm:mt-3 sm:text-3xl ${color}`}>{value}</p>
    </div>
  );
};

export default StatCard;
