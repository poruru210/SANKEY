// types/next-auth.d.ts
import { DefaultSession } from "next-auth"
import { JWT as DefaultJWT } from "next-auth/jwt"

declare module "next-auth" {
    interface Session extends DefaultSession {
        idToken?: string
        error?: string
    }
}

declare module "next-auth/jwt" {
    interface JWT extends DefaultJWT {
        accessToken?: string
        idToken?: string
        refreshToken?: string
        accessTokenExpires?: number
        error?: string
    }
}