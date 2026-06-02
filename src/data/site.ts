export interface Category {
  id: number;
  name: string;
  slug: string;
}

export const categories: Category[] = [
  { id: 1, name: "Aged Twitter", slug: "aged-twitter" },
  { id: 2, name: "Aged Instagram", slug: "aged-instagram" },
  { id: 3, name: "Random Facebook", slug: "random-facebook" },
  { id: 4, name: "USA Facebook", slug: "usa-facebook" },
  { id: 5, name: "Tools", slug: "tools" },
  { id: 6, name: "Working Profiles with Picture & Video", slug: "working-profiles" },
  { id: 7, name: "Below 50 Friend Countries Facebook", slug: "below-50-friend" },
];

export const navLinks = [
  { name: "Home", to: "/" as const },
  { name: "About", to: "/about" as const },
  { name: "Products", to: "/products" as const },
  { name: "Blog", to: "/blog" as const },
  { name: "Contact", to: "/contact" as const },
];

export interface Testimonial {
  id: number;
  name: string;
  role: string;
  content: string;
  avatar: string;
}

export const testimonials: Testimonial[] = [
  {
    id: 1,
    name: "John D.",
    role: "Social Media Manager",
    content:
      "Sammy Store Logs made it incredibly easy for us to enhance our social media presence. The account we purchased had an engaged following, which boosted our brand's credibility almost instantly. Smooth, secure, and well supported.",
    avatar: "/images/avatar-1.jpg",
  },
  {
    id: 2,
    name: "Emily S.",
    role: "Entrepreneur",
    content:
      "As a startup, building a social media following from scratch was daunting. Sammy Store provided a perfect solution. The account we acquired was exactly as described, with a real, active follower base.",
    avatar: "/images/avatar-2.jpg",
  },
  {
    id: 3,
    name: "Alex R.",
    role: "Influencer",
    content:
      "I needed to expand my reach on a new platform, and Sammy Store was the perfect choice. The account I bought was well-maintained and came with authentic followers. Seamless transfer.",
    avatar: "/images/avatar-3.jpg",
  },
];

export interface Blog {
  id: number;
  title: string;
  excerpt: string;
  date: string;
  image: string;
  slug: string;
}

export const blogs: Blog[] = [
  {
    id: 1,
    title: "But why do people buy social media accounts?",
    excerpt:
      "Instant credibility: purchasing a social media account with an established following instantly boosts your authority and saves months of slow organic growth.",
    date: "06 Sep, 2023",
    image: "/images/blog-1.jpg",
    slug: "but-why-do-people-buy-social-media-accounts",
  },
];

export const contactInfo = {
  email: "1sammystore1@gmail.com",
  phone: "+234 816 313 7129",
  phoneRaw: "+2348163137129",
  whatsappSupport: "https://wa.me/2348163137129",
  whatsappGroup: "https://chat.whatsapp.com/Jjf0FDLFmxMEDEV9Hjo1Yt",
  telegramSupport: "https://t.me/Sammy_store_logs",
  telegramChannel: "https://t.me/sammystorelogss",
  location: "Nigeria",
};

export const ADMIN_OWNER_EMAIL = "1sammystore1@gmail.com";
