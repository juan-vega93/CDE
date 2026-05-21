import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    if (pathname === "/login" && token) {
      return NextResponse.redirect(new URL("/admin/project-cards", req.url));
    }

    if (pathname === "/" && token) {
      return NextResponse.redirect(new URL("/admin/project-cards", req.url));
    }

    return NextResponse.next();
  },
  {
    pages: {
      signIn: "/login"
    },
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;

        if (pathname === "/login") {
          return true;
        }

        if (pathname === "/") {
          return !!token;
        }

        if (pathname.startsWith("/admin")) {
          const roles = Array.isArray(token?.roles) ? token.roles : [];

          if (pathname.startsWith("/admin/project-cards")) {
            return !!token;
          }

          return roles.includes("bim-manager");
        }

        return !!token;
      }
    }
  }
);

export const config = {
  matcher: [
    "/",
    "/login",
    "/admin/:path*",
    "/documents/:path*",
    "/workflows/:path*",
    "/viewer/:path*"
  ]
};