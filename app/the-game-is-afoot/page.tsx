import CraneHeader from "@/components/CraneHeader";
import CraneFooter from "@/components/CraneFooter";
import TheGameIsAfoot from "@/articles/the-game-is-afoot";

export default function TheGameIsAfootPage() {
  return (
    <main className="min-h-screen bg-dark-950 text-dark-100 flex flex-col">
      <CraneHeader crumbs={[{ label: "The Game is aFoot" }]} />

      <div className="max-w-5xl mx-auto px-8 py-16 w-full">
        <TheGameIsAfoot />
      </div>

      <CraneFooter />
    </main>
  );
}
