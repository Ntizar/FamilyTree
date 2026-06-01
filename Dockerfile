# Nginx Dockerfile for FamilyTree
# Static file server — compatible with NaN.builders

FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Custom nginx config optimized for SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy all static files
COPY . /usr/share/nginx/html

EXPOSE 6500
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
