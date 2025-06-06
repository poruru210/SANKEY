import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { webcrypto } from 'crypto';

const client = new SSMClient({});

export async function getMasterKey(): Promise<CryptoKey> {
  const paramName = process.env.MASTER_KEY_PARAM!;
  const { Parameter } = await client.send(new GetParameterCommand({
    Name: paramName,
    WithDecryption: true
  }));
  const keyBuffer = Buffer.from(Parameter!.Value!, 'base64');
  return webcrypto.subtle.importKey('raw', keyBuffer, 'AES-CBC', true, ['encrypt']);
}
