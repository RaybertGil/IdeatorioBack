# Usar una imagen oficial de Node.js como imagen base
FROM node:16-alpine

# Establecer el directorio de trabajo en el contenedor
WORKDIR /usr/src/app

# Copiar los archivos de package.json y package-lock.json
COPY package.json package-lock.json ./

# Instalar dependencias
RUN npm install 

# Copiar el resto del código de la aplicación
COPY . .

# Establecer variables de entorno por defecto
ENV NODE_ENV=production

# Exponer el puerto en el que escucha tu aplicación
EXPOSE 3000

# Comando para ejecutar tu aplicación
CMD ["node", "backend/server.js"]
