require('dotenv').config();

const { dbConnection } = require('../database/configdb');
const Product = require('../models/products');
const User = require('../models/users');
const { slugify, ensureUniqueSlug } = require('../helpers/slug');

const buildUserSlugBase = (user) => {
    if (!user) return 'usuario';
    const company = user.company_name && String(user.company_name).trim();
    if (company) return company;
    const name = [user.name, user.surname].filter(Boolean).join(' ').trim();
    if (name) return name;
    return user.email || 'usuario';
};

const backfillProductSlugs = async () => {
    const products = await Product.find({ $or: [{ slug: { $exists: false } }, { slug: '' }, { slug: null }] });
    let updated = 0;

    for (const product of products) {
        const base = slugify(product.name);
        const slug = await ensureUniqueSlug(Product, base, product._id);
        await Product.collection.updateOne({ _id: product._id }, { $set: { slug } });
        updated += 1;
    }

    return updated;
};

const backfillUserSlugs = async () => {
    const users = await User.find({ $or: [{ slug: { $exists: false } }, { slug: '' }, { slug: null }] });
    let updated = 0;

    for (const user of users) {
        const base = buildUserSlugBase(user);
        const slug = await ensureUniqueSlug(User, slugify(base), user._id);
        await User.collection.updateOne({ _id: user._id }, { $set: { slug } });
        updated += 1;
    }

    return updated;
};

const run = async () => {
    try {
        await dbConnection();
        const productCount = await backfillProductSlugs();
        const userCount = await backfillUserSlugs();
        process.exit(0);
    } catch (error) {
        console.error('Error en backfill de slugs:', error);
        process.exit(1);
    }
};

run();
