import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { OtpChannelUsed, PreferredOtpChannel } from './request-otp.dto';

const E164_NIGERIA = /^\+234\d{10}$/;

export class OtpChannelsLookupDto {
  @ApiProperty({ example: '+2348012345678', description: 'E.164 Nigerian phone number.' })
  @IsString()
  @Matches(E164_NIGERIA, { message: 'phone must be E.164 Nigerian (+234XXXXXXXXXX).' })
  phone!: string;
}

export class OtpChannelEntryDto {
  @ApiProperty({ enum: OtpChannelUsed, example: OtpChannelUsed.WhatsApp })
  kind!: OtpChannelUsed;

  @ApiProperty({ example: true, description: 'Always `true` — the endpoint must not leak phone existence.' })
  available!: true;

  @ApiProperty({ example: 'your WhatsApp', description: 'Pre-localised copy hint.' })
  hint!: string;
}

export class OtpChannelsResponseDto {
  @ApiProperty({ type: [OtpChannelEntryDto] })
  channels!: OtpChannelEntryDto[];

  @ApiProperty({
    enum: PreferredOtpChannel,
    example: PreferredOtpChannel.Auto,
    description:
      'Always `"auto"` — the lookup endpoint is public and rate-limited, so it never reveals whether the phone has a registered device. The mobile should echo `auto` back as `preferred_channel` when calling `POST /v1/auth/otp/request`.',
  })
  default!: PreferredOtpChannel;
}
