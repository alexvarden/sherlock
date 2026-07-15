"use client";

import { useRouter } from "next/navigation";

interface StoryMeta {
  slug: string;
  name: string;
}

export default function StorySwitcher({
  current,
  stories,
  basePath = "/graph",
}: {
  current: StoryMeta;
  stories: StoryMeta[];
  basePath?: string;
}) {
  const router = useRouter();
  return (
    <select
      value={current.slug}
      onChange={(e) => router.push(`${basePath}?story=${e.target.value}`)}
      className="bg-dark-800 text-dark-100 text-sm px-2 py-1 rounded border border-dark-700 hover:border-dark-500 focus:outline-none focus:border-crimson-500 transition-colors cursor-pointer"
    >
      {stories.map((s) => (
        <option key={s.slug} value={s.slug}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
