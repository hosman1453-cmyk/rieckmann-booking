"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function BookPage() {
  const [name, setName] = useState("")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [service, setService] = useState("")
  const [bookedTimes, setBookedTimes] = useState<string[]>([])

  const [therapists, setTherapists] = useState<any[]>([])
  const [therapistId, setTherapistId] = useState<number | null>(null)

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  const times = [
    "09:00",
    "10:00",
    "11:00",
    "12:00",
    "13:00",
    "14:00",
    "15:00",
  ]

  // 🔹 BOOKED TIMES
  const fetchBookedTimes = async (selectedDate: string) => {
    const { data } = await supabase
      .from("appointments")
      .select("time")
      .eq("date", selectedDate)

    if (data) {
      setBookedTimes(data.map((d) => d.time))
    }
  }

  // 🔹 THERAPISTS
  const fetchTherapists = async () => {
    const { data } = await supabase
      .from("therapists")
      .select("*")
      .eq("active", true)

    setTherapists(data ?? [])
  }

  useEffect(() => {
    fetchTherapists()
  }, [])

  const handleSubmit = async (e: any) => {
    e.preventDefault()

    if (!name || !date || !time || !service) {
      setMessage("❌ Bitte alle Felder ausfüllen")
      return
    }

    setLoading(true)
    setMessage("")

    // duplicate check
    const { data: existing } = await supabase
      .from("appointments")
      .select("*")
      .eq("date", date)
      .eq("time", time)

    if (existing && existing.length > 0) {
      setMessage("⛔ Dieser Termin ist bereits vergeben!")
      setLoading(false)
      return
    }

    // insert
    const { error } = await supabase.from("appointments").insert({
      name,
      date,
      time,
      service,
      therapist_id: therapistId,
    })

    setLoading(false)

    if (error) {
      setMessage("❌ Fehler beim Buchen")
      return
    }

    setMessage("✅ Termin erfolgreich gebucht!")

    setName("")
    setDate("")
    setTime("")
    setService("")
    setTherapistId(null)
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "linear-gradient(135deg, #f5f5f5, #eaeaea)",
        fontFamily: "Arial",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "500px",
          background: "white",
          padding: "30px",
          borderRadius: "20px",
          boxShadow: "0 15px 40px rgba(0,0,0,0.12)",
        }}
      >
        <h1 style={{ textAlign: "center", marginBottom: "5px" }}>
          Termin buchen
        </h1>

        <p style={{ textAlign: "center", color: "#666", marginBottom: "20px" }}>
          Wählen Sie Datum, Zeit und Behandlung
        </p>

        {message && (
          <div
            style={{
              marginBottom: "15px",
              padding: "10px",
              borderRadius: "8px",
              background: "#f3f3f3",
              textAlign: "center",
              fontSize: "14px",
            }}
          >
            {message}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          {/* NAME */}
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />

          {/* DATE */}
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              fetchBookedTimes(e.target.value)
            }}
            style={inputStyle}
          />

          {/* THERAPIST SELECT */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <button
              type="button"
              onClick={() => setTherapistId(null)}
              style={{
                padding: "10px",
                borderRadius: "10px",
                border:
                  therapistId === null
                    ? "2px solid black"
                    : "1px solid #ddd",
                background: therapistId === null ? "black" : "white",
                color: therapistId === null ? "white" : "black",
              }}
            >
              Egal
            </button>

            {therapists.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTherapistId(t.id)}
                style={{
                  padding: "10px",
                  borderRadius: "10px",
                  border:
                    therapistId === t.id
                      ? "2px solid black"
                      : "1px solid #ddd",
                  background: therapistId === t.id ? "black" : "white",
                  color: therapistId === t.id ? "white" : "black",
                }}
              >
                {t.name}
              </button>
            ))}
          </div>

          {/* TIME GRID */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "10px",
            }}
          >
            {times.map((t) => {
              const isBooked = bookedTimes.includes(t)

              return (
                <button
                  key={t}
                  type="button"
                  disabled={isBooked}
                  onClick={() => setTime(t)}
                  style={{
                    padding: "10px",
                    borderRadius: "10px",
                    border:
                      time === t ? "2px solid black" : "1px solid #ddd",
                    background: isBooked
                      ? "#eee"
                      : time === t
                      ? "black"
                      : "white",
                    color: isBooked
                      ? "#999"
                      : time === t
                      ? "white"
                      : "black",
                    cursor: isBooked ? "not-allowed" : "pointer",
                  }}
                >
                  {t}
                </button>
              )
            })}
          </div>

          {/* SERVICE */}
          <input
            placeholder="Behandlung"
            value={service}
            onChange={(e) => setService(e.target.value)}
            style={inputStyle}
          />

          {/* SUBMIT */}
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "14px",
              borderRadius: "12px",
              border: "none",
              background: loading ? "#666" : "black",
              color: "white",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            {loading ? "Buchung..." : "Termin buchen"}
          </button>
        </form>
      </div>
    </div>
  )
}

const inputStyle = {
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid #ddd",
  outline: "none",
}