import { withAuth } from "next-auth/middleware";

export default withAuth(
  function middleware() {},
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;

        if (pathname === "/" || pathname === "/login") {
          return true;
        }

        if (pathname.startsWith("/admin")) {
          const roles = Array.isArray(token?.roles) ? token.roles : [];
          return roles.includes("bim-manager");
        }

        return !!token;
      }
    }
  }
);

export const config = {
  matcher: [
    "/documents/:path*",
    "/workflows/:path*",
    "/admin/:path*"
  ]
};