// Script para agregar estadísticas periódicas (diarias, semanales, mensuales)

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Stats = require('./../models/stats');
const StatsAggregate = require('./../models/statsAggregate');
const moment = require('moment');
const MONGODB_URI = process.env.DBCONNECTION || 'mongodb://localhost:27017/abp';

const User = require('./../models/users');
const Product = require('./../models/products');

async function aggregateStats(periodo) {
  let groupBy, start, end;
  const now = moment().startOf('day');
  if (periodo === 'hoy') {
    start = now;
    end = now.clone().add(1, 'day');
    groupBy = { $dayOfYear: '$fecha' };
  } else if (periodo === 'dia') {
    start = now.clone().subtract(1, 'day');
    end = now;
    groupBy = { $dayOfYear: '$fecha' };
  } else if (periodo === 'semana') {
    start = now.clone().subtract(1, 'week').startOf('isoWeek');
    end = now.clone().startOf('isoWeek');
    groupBy = { $isoWeek: '$fecha' };
  } else if (periodo === 'mes') {
    start = now.clone().subtract(1, 'month').startOf('month');
    end = now.clone().startOf('month');
    groupBy = { $month: '$fecha' };
  } else {
    throw new Error('Periodo no soportado');
  }
  const count = await Stats.countDocuments({ fecha: { $gte: start.toDate(), $lt: end.toDate() } });

  // Agregación avanzada: para view_artisan_profile agrupar por detalles.artisan_id (el visitado)
  const datos = await Stats.aggregate([
    { $match: { fecha: { $gte: start.toDate(), $lt: end.toDate() } } },
    { $addFields: {
        artisanVisitado: {
          $cond: [
            { $eq: ['$tipo', 'view_artisan_profile'] },
            '$detalles.artisan_id',
            null
          ]
        },
        artisanProducto: {
          $cond: [
            { $eq: ['$tipo', 'product_modal_open'] },
            '$detalles.artisan_id',
            null
          ]
        }
      }
    },
    { $group: {
      _id: {
        tipo: '$tipo',
        producto: '$producto',
        usuario: '$usuario',
        artisanVisitado: '$artisanVisitado',
        artisanProducto: '$artisanProducto'
      },
      total: { $sum: 1 }
    }}
  ]);

  // Inicializar todos los tipos de evento posibles con total: 0
  const tiposPosibles = [
    'view_artisan_profile',
    'product_modal_open',
    'product_modal_view_full',
    'product_modal_duration',
    'favoritos'
    // Agrega aquí otros tipos que quieras asegurar
  ];
  const resumen = {};
  for (const tipo of tiposPosibles) {
    resumen[tipo] = { total: 0, porProducto: {}, porUsuario: {}, porArtisan: {} };
  }
  // Para cruces por producto
  const productStats = {};
  // 1ª pasada: igual que antes, pero recogemos product_modal_duration y product_modal_view_full
  for (const d of datos) {
    const tipo = d._id.tipo || 'otro';
    if (!resumen[tipo]) resumen[tipo] = { total: 0, porProducto: {}, porUsuario: {}, porArtisan: {} };
    resumen[tipo].total += d.total;
    if (d._id.producto) {
      const prod = String(d._id.producto);
      resumen[tipo].porProducto[prod] = (resumen[tipo].porProducto[prod] || 0) + d.total;
      // Inicializar stats cruzados
      if (!productStats[prod]) productStats[prod] = { clicks: 0, viewFull: 0, durationSum: 0, durationCount: 0 };
      if (tipo === 'product_modal_open') productStats[prod].clicks += d.total;
      if (tipo === 'product_modal_view_full') productStats[prod].viewFull += d.total;
    }
    // Para product_modal_duration, sumar duración
    if (tipo === 'product_modal_duration' && d._id.producto) {
      const prod = String(d._id.producto);
      // Buscar todos los eventos individuales de duración para este producto en el periodo
      // (d.total es el número de eventos, pero necesitamos la suma de duration_ms)
      // Hacemos una query directa a la colección Stats para sumar duration_ms
      // (esto es eficiente porque solo se hace para productos con duración)
      productStats[prod] = productStats[prod] || { clicks: 0, viewFull: 0, durationSum: 0, durationCount: 0 };
      // Se suma después del bucle (ver más abajo)
    }
    if (d._id.usuario) {
      const user = String(d._id.usuario);
      resumen[tipo].porUsuario[user] = (resumen[tipo].porUsuario[user] || 0) + d.total;
    }
    if (tipo === 'view_artisan_profile' && d._id.artisanVisitado) {
      const artisan = String(d._id.artisanVisitado);
      resumen[tipo].porArtisan[artisan] = (resumen[tipo].porArtisan[artisan] || 0) + d.total;
    }
    if (tipo === 'product_modal_open' && d._id.artisanProducto) {
      const artisan = String(d._id.artisanProducto);
      resumen[tipo].porArtisan[artisan] = (resumen[tipo].porArtisan[artisan] || 0) + d.total;
    }
  }

  // 2ª pasada: sumar duración total y contar eventos para cada producto
  for (const prod of Object.keys(productStats)) {
    // Sumar duración total y contar eventos para este producto
    const match = { tipo: 'product_modal_duration', producto: prod, fecha: { $gte: start.toDate(), $lt: end.toDate() } };
    const duraciones = await Stats.find(match, { 'detalles.duration_ms': 1 }).lean();
    let sum = 0, count = 0;
    for (const ev of duraciones) {
      const ms = ev.detalles?.duration_ms;
      if (typeof ms === 'number') {
        sum += ms;
        count++;
      }
    }
    productStats[prod].durationSum = sum;
    productStats[prod].durationCount = count;
  }


  // 3ª pasada: calcular métricas cruzadas
  resumen.productAnalytics = {};
  for (const prod of Object.keys(productStats)) {
    const stats = productStats[prod];
    const avgDuration = stats.durationCount > 0 ? stats.durationSum / stats.durationCount : 0;
    const pctViewFull = stats.clicks > 0 ? (stats.viewFull / stats.clicks) * 100 : 0;
    resumen.productAnalytics[prod] = {
      clicks: stats.clicks,
      viewFull: stats.viewFull,
      avgDuration,
      pctViewFull
    };
  }

  // --- Agregación temporal de usuarios y productos ---
  try {
    if (["hoy", "dia"].includes(periodo)) {
      // Por hora (0-23)
      const usuariosPorHora = await User.aggregate([
        { $match: { createdAt: { $gte: start.toDate(), $lt: end.toDate() } } },
        { $group: { _id: { $hour: "$createdAt" }, count: { $sum: 1 } } }
      ]);
      const usuariosPorHoraArray = Array(24).fill(0);
      usuariosPorHora.forEach(h => { if(h._id !== null) usuariosPorHoraArray[h._id] = h.count; });
      resumen.usuariosPorHora = usuariosPorHoraArray;

      const productosPorHora = await Product.aggregate([
        { $match: { createdAt: { $gte: start.toDate(), $lt: end.toDate() } } },
        { $group: { _id: { $hour: "$createdAt" }, count: { $sum: 1 } } }
      ]);
      const productosPorHoraArray = Array(24).fill(0);
      productosPorHora.forEach(h => { if(h._id !== null) productosPorHoraArray[h._id] = h.count; });
      resumen.productosPorHora = productosPorHoraArray;
    } else if (periodo === 'semana') {
      // Por día de la semana (1=lunes, 7=domingo)
      const usuariosPorDia = await User.aggregate([
        { $match: { createdAt: { $gte: start.toDate(), $lt: end.toDate() } } },
        { $group: { _id: { $isoDayOfWeek: "$createdAt" }, count: { $sum: 1 } } }
      ]);
      const usuariosPorDiaArray = Array(7).fill(0);
      usuariosPorDia.forEach(d => { if(d._id !== null) usuariosPorDiaArray[d._id - 1] = d.count; });
      resumen.usuariosPorDia = usuariosPorDiaArray;

      const productosPorDia = await Product.aggregate([
        { $match: { createdAt: { $gte: start.toDate(), $lt: end.toDate() } } },
        { $group: { _id: { $isoDayOfWeek: "$createdAt" }, count: { $sum: 1 } } }
      ]);
      const productosPorDiaArray = Array(7).fill(0);
      productosPorDia.forEach(d => { if(d._id !== null) productosPorDiaArray[d._id - 1] = d.count; });
      resumen.productosPorDia = productosPorDiaArray;
    } else {
      // Por día del mes
      const dias = end.diff(start, 'days');
      const usuariosPorDia = await User.aggregate([
        { $match: { createdAt: { $gte: start.toDate(), $lt: end.toDate() } } },
        { $group: { _id: { $dayOfMonth: "$createdAt" }, count: { $sum: 1 } } }
      ]);
      const usuariosPorDiaArray = Array(dias).fill(0);
      usuariosPorDia.forEach(d => { if(d._id !== null) usuariosPorDiaArray[d._id - 1] = d.count; });
      resumen.usuariosPorDia = usuariosPorDiaArray;

      const productosPorDia = await Product.aggregate([
        { $match: { createdAt: { $gte: start.toDate(), $lt: end.toDate() } } },
        { $group: { _id: { $dayOfMonth: "$createdAt" }, count: { $sum: 1 } } }
      ]);
      const productosPorDiaArray = Array(dias).fill(0);
      productosPorDia.forEach(d => { if(d._id !== null) productosPorDiaArray[d._id - 1] = d.count; });
      resumen.productosPorDia = productosPorDiaArray;
    }
  } catch (err) {
    console.error('[aggregate-stats] Error en agregación temporal:', err);
  }

  if (Object.keys(resumen).length === 0) {
    return;
  }
  const fechaInicio = start.toDate();
  const fechaFin = end.toDate();
  await StatsAggregate.findOneAndUpdate(
    { periodo, fechaInicio, fechaFin },
    {
      $set: {
        datos: resumen,
        creadoEn: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  for (const periodo of ['hoy', 'dia', 'semana', 'mes']) {
    await aggregateStats(periodo);
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  main().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
