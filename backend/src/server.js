const app = require('./app');
const env = require('./config/env');

const server = app.listen(env.port, () => {
  console.log(`Servidor backend corriendo en http://localhost:${env.port}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `No se pudo iniciar el backend porque el puerto ${env.port} ya esta en uso. Cierra la otra instancia o cambia PORT en el archivo .env.`
    );
    process.exit(1);
  }

  console.error('No fue posible iniciar el backend.', error);
  process.exit(1);
});
