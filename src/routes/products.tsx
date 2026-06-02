import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Facebook, Instagram, Twitter, Youtube, Wrench, Loader2, ShoppingCart, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { PageHero } from "@/components/sections/PageHero";
import { categories as staticCategories } from "@/data/site";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const searchSchema = z.object({ cat: z.string().optional() });

export const Route = createFileRoute("/products")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Products — Sammy Store Logs" },
      { name: "description", content: "Browse verified social media account categories: Aged Twitter, Instagram, Facebook, Tools and more." },
      { property: "og:title", content: "Our Products" },
      { property: "og:description", content: "Verified accounts across all major social media platforms." },
    ],
  }),
  component: ProductsPage,
});

type DbCategory = { id: string; name: string; slug: string; description: string | null };
type Product = { id: string; title: string; price: number; stock: number; description: string | null; image_url: string | null; slug: string; currency: string };

const platformIcons: Record<string, React.ElementType> = {
  "aged-twitter": Twitter,
  "aged-instagram": Instagram,
  "random-facebook": Facebook,
  "usa-facebook": Facebook,
  tools: Wrench,
  "working-profiles": Instagram,
  "below-50-friend": Facebook,
  youtube: Youtube,
};

function ProductsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/products" });
  const [dbCategories, setDbCategories] = useState<DbCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [buyTarget, setBuyTarget] = useState<Product | null>(null);
  const [buying, setBuying] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  const activeCat = search.cat;
  const activeCategory = dbCategories.find((c) => c.slug === activeCat);

  // Fetch categories
  useEffect(() => {
    supabase.from("product_categories").select("*").order("name").then(({ data }) => {
      if (data?.length) setDbCategories(data as DbCategory[]);
    });
  }, []);

  // Fetch products when category changes
  useEffect(() => {
    if (!activeCat) { setProducts([]); return; }
    setProductsLoading(true);
    supabase
      .from("products")
      .select("id, title, price, stock, description, image_url, slug, currency")
      .eq("published", true)
      .eq("category_id", dbCategories.find((c) => c.slug === activeCat)?.id ?? "")
      .order("price")
      .then(({ data }) => {
        setProducts((data as Product[]) ?? []);
        setProductsLoading(false);
      });
  }, [activeCat, dbCategories]);

  // Fetch wallet balance for purchase check
  useEffect(() => {
    if (!user) return;
    supabase.from("wallets").select("balance").eq("user_id", user.id).single().then(({ data }) => {
      if (data) setWalletBalance(Number(data.balance));
    });
  }, [user]);

  const displayCategories = dbCategories.length > 0 ? dbCategories : staticCategories.map((c) => ({ id: String(c.id), name: c.name, slug: c.slug, description: null }));

  const handleBuy = async () => {
    if (!buyTarget) return;
    if (!user) { navigate({ to: "/auth", search: { redirect: "/products" } }); return; }
    if (walletBalance === null) return toast.error("Wallet not found");
    if (walletBalance < buyTarget.price) {
      toast.error(`Insufficient balance. You need ₦${buyTarget.price.toLocaleString()} but have ₦${walletBalance.toLocaleString()}.`);
      return;
    }

    setBuying(true);
    const { error } = await supabase.rpc("purchase_with_wallet" as never, {
      _user_id: user.id,
      _product_id: buyTarget.id,
      _quantity: 1,
    } as never);
    setBuying(false);

    if (error) {
      if (error.message.includes("insufficient")) toast.error("Insufficient wallet balance");
      else if (error.message.includes("stock")) toast.error("Out of stock");
      else toast.error(error.message);
    } else {
      toast.success(`Purchase successful! Check your dashboard for order details.`);
      setBuyTarget(null);
      // Refresh wallet balance
      supabase.from("wallets").select("balance").eq("user_id", user.id).single().then(({ data }) => {
        if (data) setWalletBalance(Number(data.balance));
      });
      // Refresh products stock
      if (activeCat) {
        supabase.from("products").select("id, title, price, stock, description, image_url, slug, currency").eq("published", true).eq("category_id", dbCategories.find((c) => c.slug === activeCat)?.id ?? "").order("price").then(({ data }) => {
          setProducts((data as Product[]) ?? []);
        });
      }
    }
  };

  return (
    <>
      <PageHero title="Our Products" subtitle="Verified accounts across every major social platform." breadcrumbs={[{ name: "Products" }]} />

      <section className="w-full bg-background py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-brand-navy mb-3 tracking-tight">Browse our categories</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">A wide range of verified social media accounts ready for immediate transfer.</p>
          </motion.div>

          {/* Category Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 mb-12">
            {displayCategories.map((category, index) => {
              const Icon = platformIcons[category.slug] ?? Facebook;
              const isActive = activeCat === category.slug;
              return (
                <motion.button
                  key={category.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, delay: index * 0.08 }}
                  whileHover={{ y: -4 }}
                  onClick={() => navigate({ to: "/products", search: { cat: isActive ? undefined : category.slug } })}
                  className={`group text-left bg-card rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all border ${isActive ? "border-brand-orange ring-2 ring-brand-orange/30" : "border-border"}`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${isActive ? "bg-brand-orange" : "bg-brand-orange/10 group-hover:bg-brand-orange"}`}>
                      <Icon className={`w-6 h-6 transition-colors ${isActive ? "text-white" : "text-brand-orange group-hover:text-white"}`} />
                    </div>
                    <span className="text-xs font-medium text-green-700 bg-green-100 px-3 py-1 rounded-full">Available</span>
                  </div>
                  <h3 className={`text-lg font-semibold mb-2 transition-colors ${isActive ? "text-brand-orange" : "text-brand-navy group-hover:text-brand-orange"}`}>{category.name}</h3>
                  <p className="text-muted-foreground text-sm mb-4">{category.description ?? `Browse verified ${category.name.toLowerCase()} accounts.`}</p>
                  <div className={`inline-flex items-center gap-2 font-medium text-sm transition-colors ${isActive ? "text-brand-orange" : "text-brand-orange hover:text-brand-orange-hover"}`}>
                    {isActive ? "Viewing products" : "Browse products"}
                    <ArrowRight className={`w-4 h-4 transition-transform ${isActive ? "rotate-90" : "group-hover:translate-x-1"}`} />
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* Products for selected category */}
          <AnimatePresence>
            {activeCat && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                  <div>
                    <h3 className="text-xl font-bold text-brand-navy">{activeCategory?.name ?? activeCat}</h3>
                    <p className="text-sm text-muted-foreground">
                      {productsLoading ? "Loading…" : `${products.length} product${products.length !== 1 ? "s" : ""} available`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {user && walletBalance !== null && (
                      <span className="text-sm text-muted-foreground">
                        Wallet: <span className="font-medium text-brand-navy">₦{walletBalance.toLocaleString()}</span>
                      </span>
                    )}
                    <button onClick={() => navigate({ to: "/products", search: {} })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-brand-navy transition-colors">
                      <X className="w-4 h-4" />Close
                    </button>
                  </div>
                </div>

                {productsLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-orange" /></div>
                ) : products.length === 0 ? (
                  <Card className="text-center py-12">
                    <CardContent>
                      <ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground font-medium">No products in this category yet</p>
                      <p className="text-sm text-muted-foreground mt-1">Check back soon or contact support</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {products.map((p, i) => (
                      <motion.div key={p.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                        <Card className="group hover:shadow-lg transition-all border-border hover:border-brand-orange/30 h-full">
                          <CardContent className="p-5 flex flex-col h-full">
                            {p.image_url && (
                              <div className="aspect-video rounded-lg overflow-hidden mb-3 bg-muted">
                                <img src={p.image_url} alt={p.title} className="w-full h-full object-cover" />
                              </div>
                            )}
                            <div className="flex-1">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <h4 className="font-semibold text-brand-navy group-hover:text-brand-orange transition-colors text-sm">{p.title}</h4>
                                <Badge className={p.stock > 0 ? "bg-green-100 text-green-700 shrink-0" : "bg-red-100 text-red-500 shrink-0"}>
                                  {p.stock > 0 ? `${p.stock} left` : "Sold out"}
                                </Badge>
                              </div>
                              {p.description && <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{p.description}</p>}
                            </div>
                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                              <div className="text-lg font-bold text-brand-navy">₦{Number(p.price).toLocaleString()}</div>
                              <Button
                                size="sm"
                                disabled={p.stock === 0}
                                onClick={() => {
                                  if (!user) { navigate({ to: "/auth", search: { redirect: "/products" } }); return; }
                                  setBuyTarget(p);
                                }}
                                className="bg-brand-orange hover:bg-brand-orange-hover text-white text-xs"
                              >
                                {p.stock === 0 ? "Out of stock" : "Buy Now"}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* CTA */}
      <section className="w-full bg-brand-navy py-16 md:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-4 tracking-tight">Can't find what you're looking for?</h2>
          <p className="text-white/70 max-w-2xl mx-auto mb-8">Contact our support team and we'll help you find the perfect account.</p>
          <Link to="/contact" className="inline-flex items-center gap-2 bg-brand-orange hover:bg-brand-orange-hover text-white px-8 py-4 rounded-lg font-semibold transition-colors">
            Contact Support<ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Purchase Dialog */}
      <Dialog open={!!buyTarget} onOpenChange={(o) => !o && setBuyTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Confirm Purchase</DialogTitle></DialogHeader>
          {buyTarget && (
            <div className="py-2 space-y-3">
              <div className="bg-muted/50 rounded-xl p-4">
                <div className="font-semibold text-brand-navy mb-1">{buyTarget.title}</div>
                <div className="text-2xl font-bold text-brand-orange">₦{Number(buyTarget.price).toLocaleString()}</div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Your wallet balance</span>
                <span className={`font-medium ${(walletBalance ?? 0) < buyTarget.price ? "text-red-500" : "text-green-600"}`}>
                  ₦{(walletBalance ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">After purchase</span>
                <span className="font-medium text-brand-navy">₦{Math.max(0, (walletBalance ?? 0) - buyTarget.price).toLocaleString()}</span>
              </div>
              {(walletBalance ?? 0) < buyTarget.price && (
                <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">
                  Insufficient balance.{" "}
                  <Link to="/wallet" className="underline font-medium">Fund your wallet →</Link>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuyTarget(null)}>Cancel</Button>
            <Button
              disabled={buying || (walletBalance ?? 0) < (buyTarget?.price ?? 0)}
              onClick={handleBuy}
              className="bg-brand-orange hover:bg-brand-orange-hover text-white"
            >
              {buying && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {buying ? "Processing…" : "Confirm Purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
