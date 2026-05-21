"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleLogin = async () => {
  alert("CLICKED")

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    alert(error.message)
    return
  }

  console.log("SESSION:", data.session)

  if (data.session) {
    window.location.href = "/admin"
  } else {
    alert("Session yok!")
  }
}

  return (
    <div style={{ padding: 40, fontFamily: "Arial" }}>
      <h1>Login</h1>

      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ display: "block", marginBottom: 10 }}
      />

      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ display: "block", marginBottom: 10 }}
      />

      <button
        onClick={handleLogin}
        style={{
          padding: "10px 15px",
          background: "black",
          color: "white",
          border: "none",
          cursor: "pointer"
        }}
      >
        Login
      </button>
    </div>
  )
}