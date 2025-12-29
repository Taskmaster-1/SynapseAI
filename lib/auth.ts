export interface User {
  name: string
  email: string
  avatar?: string
}

export function saveUser(user: User) {
  if (typeof window !== "undefined") {
    localStorage.setItem("user", JSON.stringify(user))
  }
}

export function getUser(): User | null {
  if (typeof window !== "undefined") {
    const userStr = localStorage.getItem("user")
    return userStr ? JSON.parse(userStr) : null
  }
  return null
}

export function clearUser() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("user")
  }
}
