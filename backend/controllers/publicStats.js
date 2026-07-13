const User = require('../models/users');
const Product = require('../models/products');

// Endpoint público para estadísticas globales mínimas
const getPublicStats = async (req, res) => {
  try {
    // Artesanos
    const artisanUsers = await User.countDocuments({ role: 'artisan' });
    // Productos
    const totalProducts = await Product.countDocuments();
    // Categorías
    const categories = Product.schema.path('category').enumValues;
    const numCategories = categories.length;

    return res.json({
      ok: true,
      stats: {
        artisans: artisanUsers,
        products: totalProducts,
        categories: numCategories
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, msg: 'Error obteniendo estadísticas públicas' });
  }
};

module.exports = { getPublicStats };
