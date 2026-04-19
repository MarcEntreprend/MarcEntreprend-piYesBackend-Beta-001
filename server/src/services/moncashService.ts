
import dotenv from 'dotenv';
dotenv.config();

const CLIENT_ID = process.env.MONCASH_CLIENT_ID || '4d1d47926758fa27c42175fe6d1780a8';
const CLIENT_SECRET = process.env.MONCASH_CLIENT_SECRET || '3KTYedyQ6RL3w0TfJBnF_CejmX-7BkWJFyQLZ5bQVgmQzhcW2oKwb5PYI4Xrzk5d';
const API_HOST = process.env.MONCASH_API_HOST || 'sandbox.moncashbutton.digicelgroup.com/Api';
const GATEWAY_URL = process.env.MONCASH_GATEWAY_URL || 'https://sandbox.moncashbutton.digicelgroup.com/Moncash-middleware';

interface MonCashTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface CustomerStatusResponse {
  type: string;
  status: string[];
}

interface CreatePaymentResponse {
  payment: {
    token: string;
    redirect_url: string;
  };
}

interface RetrieveTransactionResponse {
  payment: {
    transaction_id: string;
    cost: number;
    message: string;
    payer: string;
  };
}

interface PrefundedBalanceResponse {
  balance: number;
}

class MonCashService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiry) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const response = await fetch(`https://${API_HOST}/oauth/token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'scope=read,write&grant_type=client_credentials'
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MonCash Auth Error: ${error}`);
    }

    const data = await response.json() as MonCashTokenResponse;
    this.accessToken = data.access_token;
    // Set expiry slightly earlier to be safe (59s -> 50s)
    this.tokenExpiry = now + (data.expires_in - 9) * 1000;
    
    return this.accessToken;
  }

  async getCustomerStatus(phoneNumber: string, pin?: string): Promise<CustomerStatusResponse> {
    const token = await this.getAccessToken();
    const response = await fetch(`https://${API_HOST}/v1/CustomerStatus`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ account: phoneNumber, pin: pin || "0000" })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MonCash KYC Error: ${error}`);
    }

    return await response.json() as CustomerStatusResponse;
  }

  async createPayment(amount: number, orderId: string): Promise<string> {
    const token = await this.getAccessToken();
    const response = await fetch(`https://${API_HOST}/v1/CreatePayment`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ amount, orderId })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MonCash CreatePayment Error: ${error}`);
    }

    const data = await response.json() as CreatePaymentResponse;
    // Construct redirect URL
    return `${GATEWAY_URL}/Payment/Redirect?token=${data.payment.token}`;
  }

  async retrieveTransactionPayment(transactionId: string): Promise<RetrieveTransactionResponse> {
    const token = await this.getAccessToken();
    const response = await fetch(`https://${API_HOST}/v1/RetrieveTransactionPayment`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ transactionId })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MonCash RetrieveTransaction Error: ${error}`);
    }

    return await response.json() as RetrieveTransactionResponse;
  }

  async getPrefundedBalance(): Promise<number> {
    const token = await this.getAccessToken();
    const response = await fetch(`https://${API_HOST}/v1/PrefundedBalance`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MonCash Balance Error: ${error}`);
    }

    const data = await response.json() as PrefundedBalanceResponse;
    return data.balance;
  }

  async transfer(amount: number, receiver: string, reference: string): Promise<any> {
    const token = await this.getAccessToken();
    const response = await fetch(`https://${API_HOST}/v1/Transfert`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount,
        receiver,
        desc: 'Retrait piYès',
        reference
      })
    });

    if (!response.ok) {
      const error = await response.text();
      // Handle 403 specifically
      if (response.status === 403) {
        throw new Error('Maximum Account Balance');
      }
      throw new Error(`MonCash Transfer Error: ${error}`);
    }

    return await response.json();
  }
}

export const moncashService = new MonCashService();
