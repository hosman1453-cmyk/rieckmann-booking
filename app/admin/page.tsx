export const dynamic = "force-dynamic"
"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function AdminPage() {
  const [appointments, setAppointments] = useState<any[]>([])

const groupedAppointments = appointments.reduce((acc: any, appt: any) => {
  if (!acc[appt.date]) {
    acc[appt.date] = []
  }
  acc[appt.date].push(appt)
  return acc
}, {})

const days = Object.keys(groupedAppointments).sort()
const handleLogout = async () => {
  await supabase.auth.signOut()
  window.location.href = "/login"
}

  const fetchAppointments = async () => {
    const { data } = await supabase
      .from("appointments")
      .select("*")
      .order("date", { ascending: true })

    if (data) {
      setAppointments(data)
    }
  }

  useEffect(() => {
    fetchAppointments()
  }, [])
  const deleteAppointment = async (id: number) => {
  await supabase
    .from("appointments")
    .delete()
    .eq("id", id)

  fetchAppointments()
}

  return (
  <div
  style={{
    padding: "20px",
    fontFamily: "Arial",
    background: "#f4f4f4",
    minHeight: "100vh"
  }}
>
    <div
  style={{
    background: "black",
    color: "white",
    padding: "20px",
    borderRadius: "12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  }}
>
  <div>
    <h1 style={{ margin: 0 }}>Rieckmann Booking</h1>
    <p style={{ margin: 0, opacity: 0.7 }}>
      Admin Dashboard
    </p>
  </div>

  <div
    style={{
      background: "#222",
      padding: "10px 15px",
      borderRadius: "8px"
    }}
  >
    <button
  onClick={handleLogout}
  style={{
    background: "red",
    color: "white",
    border: "none",
    padding: "10px 15px",
    borderRadius: "8px",
    cursor: "pointer"
  }}
>
  Logout
</button>
  </div>
</div>

    {/* STATS */}
    <div style={{ display: "flex", gap: "20px", marginTop: "20px" }}>
      <div style={{ padding: "20px", background: "black", color: "white", borderRadius: "10px" }}>
        <h2>{appointments.length}</h2>
        <p>Total</p>
      </div>

      <div style={{ padding: "20px", background: "#444", color: "white", borderRadius: "10px" }}>
        <h2>
          {appointments.filter(a => a.date === new Date().toISOString().split("T")[0]).length}
        </h2>
        <p>Today</p>
      </div>
    </div>

    {/* GRID */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "20px",
        marginTop: "40px"
      }}
    >
      {days.map((date) => (
        <div
          key={date}
          style={{
            border: "1px solid #ddd",
            borderRadius: "12px",
            padding: "15px",
            background: "#fafafa"
          }}
        >
          {/* DATE HEADER */}
          <h3
            style={{
              background: "black",
              color: "white",
              padding: "8px",
              borderRadius: "6px",
              textAlign: "center"
            }}
          >
            {date}
          </h3>

          {/* APPOINTMENTS */}
          {groupedAppointments[date].map((appt: any) => (
            <div
              key={appt.id}
              style={{
                marginTop: "10px",
                padding: "10px",
                border: "1px solid #eee",
                boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                borderRadius: "8px",
                background: "white",
                transform: "scale(1)",

transition: "0.2s",
cursor: "pointer"
              }}
            >
              <b>{appt.name}</b>
              <div>⏰ {appt.time}</div>
              <div>💆 {appt.service}</div>

              <button
                onClick={() => deleteAppointment(appt.id)}
                style={{
                  marginTop: "8px",
                  padding: "6px 10px",
                  background: "red",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer"
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>

  )
}