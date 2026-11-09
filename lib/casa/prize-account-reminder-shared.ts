/** Un premio en dinero que la casa aún no paga porque el ganador no tiene cuenta. */
export interface PremioSinCuenta {
  pollaId: string;
  slug: string;
  nombre: string;
  montoCop: number;
}

/** Falta la cuenta de pago: por un premio ganado o por una polla pagada en juego. */
export interface CuentaPendiente {
  premios: PremioSinCuenta[];
  enJuego: boolean;
}
