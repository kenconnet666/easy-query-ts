/** 找不到页面 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { Container, Flex, H1, LinkButton, Paragraph } from '@zerodep-dev/vue-tsx-pro-ui';

export default _component(() => () => (
  <Container size="md" padding="none">
    <Flex direction="column" gap="lg" align="start">
      <H1>找不到这一页</H1>
      <Paragraph tone="muted">地址可能写错了，或者这一页已经搬走。</Paragraph>
      <LinkButton href="/">回到首页</LinkButton>
    </Flex>
  </Container>
));
