import { appIcon, type AppIconShape } from "@/lib/app-icon";

// The manifest's icons (src/app/manifest.ts). Built once at build time.
const VARIANTS: Record<string, [number, AppIconShape]> = {
  "192": [192, "rounded"],
  "512": [512, "rounded"],
  "maskable-512": [512, "maskable"],
};

export const dynamicParams = false;

export function generateStaticParams(): { variant: string }[] {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ variant: string }> },
): Promise<Response> {
  const variant = VARIANTS[(await params).variant];
  if (!variant) return new Response("Not found", { status: 404 });
  return appIcon(...variant);
}
