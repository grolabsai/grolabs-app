import { redirect } from "next/navigation";

export default function CatalogIndex() {
  redirect("/catalog/products");
}
