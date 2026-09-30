import { buildRobots } from "@/lib/seo/robotsPolicy";

/**
 * Paths to hide from crawlers. Every entry is validated by
 * lib/seo/robotsPolicy.js before it reaches robots.txt; invalid entries are dropped.
 * Empty by default so the output is identical to the previous behaviour.
 */
const DISALLOW_CANDIDATES = [];

export default function robots() {
  return buildRobots(DISALLOW_CANDIDATES, process.env.NEXT_PUBLIC_SITE_URL);
}