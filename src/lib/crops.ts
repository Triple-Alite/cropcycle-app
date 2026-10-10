export const CROP_OPTIONS = [
  "Yam",
  "Maize",
  "Beans",
  "Guinea Corn",
  "Rice",
  "Groundnut",
  "Soya Beans",
  "Tomatoes",
  "Pepper",
  "Millet",
  "Okro",
  "Bambara nut",
  "Cassava",
  "Spinach",
  "Hibiscus",
  "Potatoes",
  "Sheanut",
  "Sesame",
  "Sugarcane",
  "Gardenegg",
  "Onions",
] as const;

const cropNamesByKey = new Map(
  CROP_OPTIONS.map((crop) => [crop.toLocaleLowerCase(), crop]),
);

export function canonicalCropName(value: string) {
  return cropNamesByKey.get(value.trim().toLocaleLowerCase());
}

export function parseCropSelections(value: unknown): string[] | null {
  if (typeof value === "string" && !value.trim()) return [];
  const values = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(values) || values.length > CROP_OPTIONS.length) return null;

  const crops: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) return null;
    const crop = canonicalCropName(value);
    if (!crop || crops.includes(crop)) return null;
    crops.push(crop);
  }
  return crops;
}

export function cropOptionsError() {
  return `Choose crops only from: ${CROP_OPTIONS.join(", ")}.`;
}
