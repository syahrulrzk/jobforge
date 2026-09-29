// Live test: LinkedIn guest jobs API → parser → description enrichment.
// Jalur sama dengan yang dipakai scheduled scrape & live search.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// 1) fetch listing guest API
const listUrl = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=frontend&location=Indonesia&start=0";
const listRes = await fetch(listUrl, {
  headers: { "User-Agent": UA, "Accept-Language": "id-ID,id;q=0.9,en;q=0.8" },
  signal: AbortSignal.timeout(15_000),
});
console.log("listing:", listRes.status, "| bytes:", (await listRes.text()).length);
const html = await (await fetch(listUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) })).text();

// 2) parse pakai mapper project (bun jalan TS langsung)
const { mapLinkedInGuestCards, enrichLinkedInDescriptions } = await import("../src/lib/jobforge/sources-real.ts");
const records = mapLinkedInGuestCards(html);
console.log("parsed cards:", records.length);
const sample = records.slice(0, 3).map((r) => ({
  title: r.rawTitle,
  company: r.rawCompanyName,
  location: r.rawLocation,
  salary: r.rawSalaryText,
  logo: r.rawCompanyLogoUrl ? "✓" : "✗",
  url: r.sourceUrl.slice(0, 70),
  scrapedAt: r.scrapedAt,
}));
console.log(JSON.stringify(sample, null, 2));

// 3) description enrichment dari detail page (cap kecil buat tes cepat)
if (records.length > 0) {
  const { records: enriched, allDescriptionsEmpty } = await enrichLinkedInDescriptions(records.slice(0, 3), {}, 3);
  console.log("descriptions filled:", enriched.filter((r) => r.rawDescription).length, "of 3 | allEmpty:", allDescriptionsEmpty);
  const withDesc = enriched.find((r) => r.rawDescription);
  if (withDesc) console.log("desc sample:", withDesc.rawDescription.slice(0, 120), "…");
}
