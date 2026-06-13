import { SiteNav } from "@/components/site-nav";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { BidMarket } from "@/components/bid-market";
import { SiteFooter } from "@/components/site-footer";

export default function Home() {
  return (
    <main>
      <SiteNav />
      <Hero />
      <BidMarket />
      <HowItWorks />
      <SiteFooter />
    </main>
  );
}
