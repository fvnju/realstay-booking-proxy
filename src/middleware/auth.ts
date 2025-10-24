import { Context, Next } from "hono";
import { Env } from "../env";
import { getCookie } from "hono/cookie";
import { jwt, verify } from "hono/jwt";

// Define the user type
export interface User {
  id: string;
  email: string;
  role: string;
  permissions: string[];
}

declare module "hono" {
  interface ContextVariableMap {
    user: User;
    userId: string;
  }
}

// Authentication middleware
export const auth = async (c: Context<{ Bindings: Env }>, next: Next) => {
  try {
    // In a real implementation, you might want to extract the JWT from headers
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        { success: false, error: "Authorization header missing or malformed" },
        401,
      );
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    // Note: For Cloudflare Workers, we might need to use Cloudflare's built-in JWT verification
    // or another method since the standard JWT middleware might not work in all environments

    // For now, implementing a simplified verification
    // In production, use proper JWT verification with your secret
    // const secret = c.env.JWT_SECRET || process.env.JWT_SECRET;

    // if (!secret) {
    //   return c.json(
    //     { success: false, error: "JWT secret not configured" },
    //     500,
    //   );
    // }

    // // Using hono's built-in JWT verification
    // const verified = await jwt({ secret: secret }).verify(c.req.raw);

    // if (!verified) {
    //   return c.json({ success: false, error: "Invalid or expired token" }, 401);
    // }

    // Add user info to context
    // const user: User = {
    //   id: verified.userId as string,
    //   email: verified.email as string,
    //   role: verified.role as string,
    //   permissions: (verified.permissions as string[]) || [],
    // };

    // c.set("user", user);
    // c.set("userId", user.id);

    await next();
  } catch (error) {
    console.error("Authentication error:", error);
    return c.json({ success: false, error: "Authentication failed" }, 401);
  }
};

// Authorization middleware for specific roles
export const requireRole = (roles: string[]) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const user = c.get("user");

    if (!user || !roles.includes(user.role)) {
      return c.json({ success: false, error: "Insufficient permissions" }, 403);
    }

    await next();
  };
};

// Authorization middleware for resource ownership
export const requireOwnership = (resourceType: "booking" | "property") => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const user = c.get("user");
    const resourceId = c.req.param("id");

    if (!user) {
      return c.json({ success: false, error: "User not authenticated" }, 401);
    }

    // In a real implementation, check if the user owns the resource
    // This would require database lookups based on resource type
    // For now, returning true for demonstration purposes
    // In a real implementation, you'd check the DB to verify ownership

    await next();
  };
};

// Public middleware to attach user info if token exists but isn't required
export const optionalAuth = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  try {
    const authHeader = c.req.header("Authorization");

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      // const secret = c.env.JWT_SECRET || process.env.JWT_SECRET;

      // if (secret) {
      //   const verified = await jwt({ secret: secret }).verify(c.req.raw);

      //   if (verified) {
      //     const user: User = {
      //       id: verified.userId as string,
      //       email: verified.email as string,
      //       role: verified.role as string,
      //       permissions: (verified.permissions as string[]) || [],
      //     };

      //     c.set("user", user);
      //     c.set("userId", user.id);
      //   }
      // }
    }

    await next();
  } catch (error) {
    // If token is invalid, just continue without user info
    await next();
  }
};
