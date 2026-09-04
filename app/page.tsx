import "./io.css";
import { Shell } from "@/components/io/Shell";
import { Search } from "@/components/io/Search";
import { HomeWatchlist } from "@/components/io/HomeWatchlist";

/**
 * Prerendered and served straight from the asset store.
 *
 * The page takes no input: a search field, a wordmark and a list that changes
 * when the registry does. Left dynamic it would cost a server render inside the
 * Worker on every single visit, which is the request that fails first when the
 * platform throttles CPU — the front page of a site whose promise is that it
 * opens instantly is the last thing that should be able to fail that way.
 */
export const dynamic = "force-static";

export default function Home() {
  return (
    <Shell search={false}>
      <main className="wrap home">
        <h1 className="home-title">
          Every US filer.<br />
          Every filed figure.
        </h1>

        <div className="home-search">
          <Search size="hero" focusOnMount />
        </div>

        <HomeWatchlist />
      </main>
    </Shell>
  );
}
