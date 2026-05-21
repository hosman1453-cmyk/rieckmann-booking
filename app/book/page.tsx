"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"

export default function BookPage() {
  const [name, setName] = useState("")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [service, setService] = useState("")
  const [bookedTimes, setBookedTimes] = useState<string[]>([])

  const fetchBookedTimes = async (selectedDate: string) => {
    const { data } = await supabase
      .from("appointments")
      .select("time")
      .eq("date", selectedDate)

    if (data) {
      setBookedTimes(data.map((d) => d.time))
    }
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()

    const { data: existing } = await supabase
      .from("appointments")
      .select("*")
      .eq("date", date)
      .eq("time", time)

    if (existing && existing.length > 0) {
      alert("Dieser Termin ist bereits vergeben!")
      return
    }

    const { error } = await supabase.from("appointments").insert({
      name,
      date,
      time,
      service,
    })

    if (error) {
      alert("Fehler beim Buchen!")
      return
    }

    alert("Termin erfolgreich gebucht!")

    setName("")
    setDate("")
    setTime("")
    setService("")
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f5f5f5",
        fontFamily: "Arial",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "white",
          padding: "30px",
          borderRadius: "16px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
        }}
      >
        <h1 style={{ textAlign: "center", marginBottom: "20px" }}>
          Termin buchen
        </h1>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #ccc",
            }}
          />

          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              fetchBookedTimes(e.target.value)
            }}
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #ccc",
            }}
          />

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            {[
              "09:00",
              "10:00",
              "11:00",
              "12:00",
              "13:00",
              "14:00",
              "15:00",
            ].map((t) => {
              const isBooked = bookedTimes.includes(t)

              return (
                <button
                  type="button"
                  key={t}
                  disabled={isBooked}
                  onClick={() => setTime(t)}
                  style={{
                    padding: "10px",
                    borderRadius: "8px",
                    border:
                      time === t ? "2px solid black" : "1px solid #ccc",
                    background: isBooked
                      ? "#ddd"
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
                  {t} {isBooked ? "❌" : ""}
                </button>
              )
            })}
          </div>

          <input
            placeholder="Behandlung"
            value={service}
            onChange={(e) => setService(e.target.value)}
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #ccc",
            }}
          />

          <button
            type="submit"
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#000",
              color: "white",
              cursor: "pointer",
            }}
          >
            Termin buchen
          </button>
        </form>
      </div>
    </div>
  )
}