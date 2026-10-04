This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## WareGuard maintenance mode

Set the server-side `WAREGUARD_MAINTENANCE_MODE` environment variable to `true`, `1`, or `on` to show the WareGuard maintenance page and restrict application routes to authenticated `father_admin` users. Leave it unset or set it to `false` for normal operation. Administrators can use `/login` to authenticate while maintenance mode is enabled.

## Role POVs and UI preview

Father Admin is the platform-level authority that provisions and manages System Admin accounts, bypasses maintenance mode, and can preview the application as Father Admin, System Admin, Staff, or Driver. The System Admin POV is a separate active application shell with a warehouse context and does not render the Father Admin navigation alongside it. The Staff and Driver selections currently show labeled coming-soon placeholders.

The View As switch changes visible UI only. It does not change the authenticated user’s Supabase role, database profile, session, RLS permissions, or server-side authorization. Only one POV is active at a time. System Admin users are assigned to one warehouse and cannot bypass maintenance mode; Staff and Driver interfaces are future work.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
